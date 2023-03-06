import * as T from '@effect/io/Effect';

export class TimeoutError {
  readonly _tag = 'TimeoutError';
}

export class RequestError {
  readonly _tag = 'RequestError';
  constructor(readonly reason: unknown) { }
}

export const request = <A>(url: string, options: RequestInit = {}) =>
  T.asyncInterrupt<never, RequestError, A>((resume) => {
    const controller = new AbortController();

    fetch(url, {
      ...options,
      signal: controller.signal,
    })
      .then(res => res.json())
      .then((response) => {
        resume(T.succeed(response as A));
      })
      .catch((error) => {
        resume(T.fail(new RequestError(error)));
      });

    return T.sync(() => {
      controller.abort();
    });
  });
