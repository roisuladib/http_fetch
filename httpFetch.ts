export const Status = {
   Ok: 200,
   Unassigned: 299,
   BadRequest: 400,
   Unauthorized: 401,
   NotFound: 404,
};

export const Methods = {
   Get: 'GET',
   Post: 'POST',
   Put: 'PUT',
   Delete: 'DELETE',
};

export const Headers = {
   'Accept': 'application/json',
   'Content-Type': 'application/json',
   'X-Requested-With': 'fetch',
};

export const AuthorizationType = {
   Bearer: 'bearer ',
   Basic: 'basic ',
};

export enum Credentials {
   SameOrigin = 'same-origin' /* default */,
   Include = 'include',
   Omit = 'omit',
}

export const addAuthorization = (headers: any, type: string, value: string) => {
   headers['Authorization'] = `${type}${value}`;
};

export const interceptError = (error: AppError): Result<null> => {
   if (error instanceof UnauthorizedError)
      /* "failed to fetch" error in case of not managed CORS policy */
      window.location.replace('/');
   /* Delete technical error details in case of an AppError (not as a base class) */
   if (!DEBUG && error.constructor === AppError) error.body = 'Technical error';
   console.error(error);
   return new Result(false, null, error);
};

class HttpHelper {
   static async getAsync<T = any>(
      url: string,
      query?: any,
      headers?: any
   ): Promise<T> {
      try {
         let response = await this.query(url, query, headers);
         return response.body;
      } catch (error) {
         interceptError(error).error;
      }
   }

   static async postAsync<T = any>(
      url: string,
      body?: any
   ): Promise<Result<T>> {
      try {
         let response = await this.command(Methods.Post, url, body);
         return new Result<T>(true, response.body);
      } catch (error) {
         return interceptError(error);
      }
   }

   static async putAsync<T = any>(url: string, body?: any): Promise<Result<T>> {
      try {
         let response = await this.command(Methods.Put, url, body);
         return new Result<T>(true, response.body);
      } catch (error) {
         return interceptError(error);
      }
   }

   static async deleteAsync<T = any>(
      url: string,
      body?: any
   ): Promise<Result<T>> {
      try {
         let response = await this.command(Methods.Delete, url, body);
         return new Result<T>(true, response.body);
      } catch (error) {
         return interceptError(error);
      }
   }

   private static query = (url: string, query?: any, headers?: any) => {
      if (query) url += '?' + HttpHelper.buildQueryParams(query, true);
      return fetch(url, {
         method: Methods.Get,
         credentials: Credentials.SameOrigin,
         headers: headers !== undefined ? headers : Headers,
      })
         .then(HttpHelper.handleResponse)
         .catch(HttpHelper.handleUnexpectedError);
   };

   private static command = (method: string, url: string, body?: any) => {
      return fetch(url, {
         method: method,
         credentials: Credentials.SameOrigin,
         headers: Headers,
         body: HttpHelper.stringifyBody(body),
      })
         .then(HttpHelper.handleResponse)
         .catch(HttpHelper.handleUnexpectedError);
   };

   private static handleResponse = response => {
      /* Cannot access to headers using headers['...'] */
      const headers = HttpHelper.readHeaders(response.headers);
      if (HttpHelper.isError(response))
         return HttpHelper.handleExpectedError(response, headers);
      return response.text().then(bodyText => {
         /* .json() throw an exception in case of empty body */
         const body = HttpHelper.parseBody(bodyText);
         return new AppResponse(body, headers);
      });
   };

   private static isError = response => {
      return response.status < Status.Ok || response.status > Status.Unassigned;
   };

   private static handleExpectedError = (error, headers) => {
      /*Expected (includes backend unhandled exceptions if returned as Http error 500)*/
      return error.text().then(bodyText => {
         /* .json() throw an exception in case of empty body */
         let body = HttpHelper.parseBody(bodyText);
         switch (error.status) {
            case Status.BadRequest:
               return Promise.reject(new BadRequestError(body, headers));
            case Status.Unauthorized:
               return Promise.reject(new UnauthorizedError(body, headers));
            case Status.NotFound:
               return Promise.reject(new NotFoundError(body, headers));
            default:
               return Promise.reject(new AppError(body, headers));
         }
      });
   };

   private static handleUnexpectedError = error => {
      /*Unexpected: Server offline, Network down, Unhandled exceptions*/
      if (!(error instanceof AppError))
         /*return need to be rejected again*/
         return Promise.reject(new AppError(error));
      /*Rejected expected errors (via handleExpectedError) will get here*/
      return Promise.reject(error);
   };

   private static buildQueryParams = (
      query: any,
      deleteEmptyParams?: boolean
   ) => {
      let params = { ...query },
         paramsAsArray = {};

      for (let param in params) {
         if (
            deleteEmptyParams &&
            (params[param] === undefined ||
               params[param] === null ||
               params[param] === '')
         )
            delete params[param];
         if (Array.isArray(params[param])) {
            paramsAsArray[param] = params[param];
            delete params[param];
         }
      }
      let searchParams = new URLSearchParams(params);
      for (let param in paramsAsArray) {
         if (paramsAsArray[param].length)
            paramsAsArray[param].forEach(element => {
               searchParams.append(param, element);
            });
      }
      return searchParams.toString();
   };

   private static parseBody = bodyText => {
      let body = {};
      try {
         /* empty or invalid json string */
         body = JSON.parse(bodyText);
      } catch {
         if (bodyText) body = { bodyText };
      }
      return body;
   };

   private static stringifyBody = body => {
      if (body instanceof FormData || body instanceof Blob) return body;
      return JSON.stringify(body); /* 'undefined', 'null' managed */
   };

   private static readHeaders = headers => {
      /* Cannot access to headers using headers['...'] */
      let headersObject = {};
      headers.forEach((value, key) => {
         headersObject[key] = value;
      });
      return headersObject;
   };

   private static performanceInfo = () => {
      let requests = (
         window.performance /* PerformanceResourceTiming interface */
            .getEntriesByType('resource') as any
      )
         .filter(x => x.initiatorType === 'fetch')
         .map(x => ({
            name: x.name,
            startTime: x.startTime,
            transferSize: x.transferSize,
            duration: x.duration,
            ttfb: x.responseStart - x.requestStart,
         }));
      console.info(requests);
   };
}

export default HttpHelper;

/* Export Response classes */

/* Could be used to wrap final result returned to the components instead of checking for '!== undefined' */
export class Result<T = any> {
   constructor(succeeded: boolean, payload?: T, error?: AppError) {
      this.succeeded = succeeded;
      this.payload = payload;
      this.error = error;
   }
   public succeeded: boolean;
   public payload: T;
   /* Check using instanceof to get status */
   public error: AppError;
}

export class AppResponse {
   constructor(public body = null, public headers = null) {
      this.body = body;
      this.headers = headers;
   }
}

export class AppError {
   constructor(public body = null, public headers = null) {
      this.body = body;
      this.headers = headers;
   }
}

export class NotFoundError extends AppError {
   constructor(body = null, headers = null) {
      super(body, headers);
   }
}

export class BadRequestError extends AppError {
   constructor(body = null, headers = null) {
      super(body, headers);
   }
}

export class UnauthorizedError extends AppError {
   constructor(body = null, headers = null) {
      super(body, headers);
   }
}
