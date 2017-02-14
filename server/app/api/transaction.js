let mongoose = require('mongoose');
let logger = require('../services/logger.js');

module.exports = app => {

    let api = {};
    let model = mongoose.model('Transaction');
    const redisKeyListByUser = 'transaction:listByUser:';
    const redisKeyGetWallet = 'transaction:getWallet:';

    api.listByUser = (req, res) => {
        let user = req.params.user;
        let team = req.params.team;
        let sprint = req.params.sprint;

        app.get('redis').get(`${redisKeyListByUser}${user}:${team}:${sprint}`, (err, transactions) => {
            if (!err && transactions != null) {
                logger.info(`Redis: GET ${redisKeyListByUser}${user}:${team}:${sprint}`);
                res.json(JSON.parse(transactions));
            } else {
                model.find({
                    $or: [
                        { 'to': user },
                        { 'from': user }
                    ],
                    'team': team,
                    'sprint': sprint
                })
                    .sort({ date: -1 })
                    .populate('to from sprint transactionType team')
                    .then((transactions) => {
                        app.get('redis').set(`${redisKeyListByUser}${user}:${team}:${sprint}`, JSON.stringify(transactions));
                        logger.info(`Redis: SET ${redisKeyListByUser}${user}:${team}:${sprint}`);
                        res.json(transactions);
                    }, (error) => {
                        logger.error(error);
                        res.sendStatus(500);
                    });
            }
        });

    };

    api.insert = (req, res) => {
        let user = req.body.from;
        let team = req.body.team;
        let sprint = req.body.sprint;
        findWallet(user._id, team._id, sprint._id).then(
            wallet => {
                let errors = runExpressValidator(req, sprint.initialAmount - wallet.totalDonated);

                if (errors) {
                    res.status(400).send(errors);
                    return;
                }

                model.create(req.body)
                    .then((transaction) => {

                        //TODO make this look nicer
                        // TO
                        app.get('redis').delRedisKeys(`${redisKeyListByUser}${transaction.to}:${transaction.team}:${transaction.sprint}`);
                        app.get('redis').delRedisKeys(`${redisKeyGetWallet}${transaction.to}:${transaction.team}:${transaction.sprint}`);
                        // FROM
                        app.get('redis').delRedisKeys(`${redisKeyListByUser}${transaction.from}:${transaction.team}:${transaction.sprint}`);
                        app.get('redis').delRedisKeys(`${redisKeyGetWallet}${transaction.from}:${transaction.team}:${transaction.sprint}`);

                        model.findOne({
                            _id: transaction._id,
                        })
                            .populate('to from sprint transactionType team')
                            .then((transaction) => {
                                // Sending transaction through socket.io
                                app.get('redis').get("user:" + transaction.to._id, (err, socketId) => {
                                    emitTransaction(err, socketId, transaction);
                                });
                                app.get('redis').get("user:" + transaction.from._id, (err, socketId) => {
                                    emitTransaction(err, socketId, transaction);
                                });
                                res.json(transaction);
                            }, (error) => {
                                logger.error(error);
                                res.sendStatus(500);
                            });
                    }, (error) => {
                        logger.error('cannot insert transaction');
                        logger.error(error);
                        res.sendStatus(500);
                    });
            },
            error => {
                res.sendStatus(500);
            }
        );
    };

    let emitTransaction = (error, socketId, transaction) => {
        if (error) {
            logger.error('Error in getting socketId from Redis');
        } else {
            let socket = app.get('io').sockets.connected[socketId];
            if (typeof socket != "undefined") {
                socket.emit('transaction', transaction);
            }
        }
    }


    api.getWallet = (req, res) => {
        let user = req.params.user;
        let team = req.params.team;
        let sprint = req.params.sprint;
        findWallet(user, team, sprint).then(
            wallet => {
                res.json(wallet);
            },
            error => {
                res.sendStatus(500);
            }
        );
    }

    let findWallet = (user, team, sprint) => {
        return new Promise((resolve, reject) => {
            app.get('redis').get(`${redisKeyGetWallet}${user}:${team}:${sprint}`, (err, wallet) => {
                if (!err && wallet != null) {
                    logger.info(`Redis: GET ${redisKeyGetWallet}${user}:${team}:${sprint}`);
                    resolve(JSON.parse(wallet));
                } else {
                    model.aggregate([
                        {
                            $match: {
                                $or: [
                                    { 'to': mongoose.Types.ObjectId(user) },
                                    { 'from': mongoose.Types.ObjectId(user) }
                                ],
                                'team': mongoose.Types.ObjectId(team),
                                'sprint': mongoose.Types.ObjectId(sprint)
                            }
                        },
                        {
                            $project: {
                                amount: 1,
                                received: {
                                    $cond: {
                                        if: { '$eq': ['$to', mongoose.Types.ObjectId(user)] },
                                        then: true,
                                        else: false
                                    }
                                }
                            }
                        },
                        {
                            $group: {
                                _id: '$received',
                                total: { $sum: "$amount" }
                            }
                        },
                        {
                            $project: {
                                _id: 0,
                                total: 1,
                                received: {
                                    $cond: {
                                        if: { '$eq': ['$_id', true] },
                                        then: true,
                                        else: false
                                    }
                                }
                            }
                        }
                    ]).then(result => {
                        let wallet = {
                            totalReceived: 0,
                            totalDonated: 0
                        };
                        result.forEach((row) => {
                            if (row.received) {
                                wallet.totalReceived = row.total;
                            } else {
                                wallet.totalDonated = row.total;
                            }
                        });
                        app.get('redis').set(`${redisKeyGetWallet}${user}:${team}:${sprint}`, JSON.stringify(wallet));
                        logger.info(`Redis: SET ${redisKeyGetWallet}${user}:${team}:${sprint}`);

                        resolve(wallet);
                    }, error => {
                        logger.error('cannot load wallet');
                        logger.error(error);
                        reject(error);
                    });
                }
            });
        });
    }

    let clearRedisKeys = () => {

    }

    let runExpressValidator = (req, funds) => {
        req.assert("from", "transaction.from is required").notEmpty();
        req.assert("to", "transaction.to is required").notEmpty();
        req.assert("date", "transaction.date is required and must be a date").notEmpty().isDate();
        req.assert("amount", "transaction.amount is required and must be a number greater than zero").notEmpty().isNumeric().gte(1);
        if(funds) {
            req.assert("amount", "insuficient funds").lte(funds);
        }
        req.assert("team", "transaction.team is required").notEmpty();
        req.assert("sprint", "transaction.sprint is required").notEmpty();
        return req.validationErrors();
    }

    return api;
};