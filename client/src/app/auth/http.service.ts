import { Injectable } from '@angular/core';
import { Http, XHRBackend, RequestOptions, Request, RequestOptionsArgs, Response, Headers } from '@angular/http';
import { Observable } from 'rxjs/Observable';
import 'rxjs/add/operator/map';
import 'rxjs/add/operator/catch';
import { Globals } from '../app.globals';

@Injectable()
export class HttpService extends Http {

    constructor(backend: XHRBackend, options: RequestOptions) {
        let token = localStorage.getItem(Globals.LOCAL_TOKEN); // your custom token getter function here
        if(!token){
            token = sessionStorage.getItem(Globals.LOCAL_TOKEN);
        }
        options.headers.set('Authorization', `Bearer ${token}`);

        options.headers.set('x-access-token', `${token}`);
        options.headers.set('Content-Type', 'application/json');

        super(backend, options);
    }

    request(url: string | Request, options?: RequestOptionsArgs): Observable<Response> {
        let token = localStorage.getItem(Globals.LOCAL_TOKEN);
        if(!token){
            token = sessionStorage.getItem(Globals.LOCAL_TOKEN);
        }
        if (typeof url === 'string') { // meaning we have to add the token to the options, not in url
            if (!options) {
                // let's make option object
                options = { headers: new Headers() };
            }
            //options.headers.set('Authorization', `Bearer ${token}`);

            options.headers.set('x-access-token', `${token}`);
            options.headers.set('Content-Type', 'application/json');

        } else {
            // we have to add the token to the url object
            //url.headers.set('Authorization', `Bearer ${token}`);

            url.headers.set('x-access-token', `${token}`);
            url.headers.set('Content-Type', 'application/json');
        }
        return super.request(url, options).catch(this.catchAuthError(this));
    }

    private catchAuthError(self: HttpService) {
        // we have to pass HttpService's own instance here as `self`
        return (res: Response) => {
            console.log(res);
            if (res.status === 401 || res.status === 403) {
                // if not authenticated
                console.log(res);
            }
            return Observable.throw(res);
        };
    }
}