import * as Context from '@effect/data/Context';
import * as Duration from '@effect/data/Duration';
import { pipe } from '@effect/data/Function';
import type { NonEmptyReadonlyArray } from '@effect/data/ReadonlyArray';
import * as Config from '@effect/io/Config';
import * as ConfigProvider from '@effect/io/Config/Provider';
import * as T from '@effect/io/Effect';
import * as L from '@effect/io/Layer';
import * as Schema from '@effect/schema';
import * as SchemaParser from '@effect/schema/Parser';
import * as SchemaParseResult from '@effect/schema/ParseResult';

import * as Fetch from '@/core/fetch';

const REPLICATE_API_KEY = Config.string('REPLICATE_API_KEY');

export class ClientResponseParseError {
  readonly _tag = 'ClientResponseParseError';
  constructor(
    readonly error: NonEmptyReadonlyArray<SchemaParseResult.ParseError>
  ) { }
}

export class ServerError {
  readonly _tag = 'ServerError';
}

export class ClientRequestError {
  readonly _tag = 'RequestError';
  constructor(readonly error: ClientResponseParseError | ServerError) { }
}

const CreatePredictionResponse = Schema.struct({
  id: Schema.string,
  version: Schema.string,
  urls: Schema.struct({
    get: Schema.string,
    cancel: Schema.string,
  }),
  created_at: pipe(Schema.string, Schema.nullable),
  started_at: pipe(Schema.string, Schema.nullable),
  completed_at: pipe(Schema.string, Schema.nullable),
  webhook_completed: pipe(Schema.unknown, Schema.nullable),
  status: Schema.string,
  input: pipe(
    Schema.struct({
      image: Schema.string,
      prompt: Schema.string,
      a_prompt: Schema.string,
      n_prompt: Schema.string,
      detect_resolution: pipe(Schema.number, Schema.nullable),
    }),
    Schema.nullable
  ),
  output: pipe(Schema.unknown, Schema.nullable),
  error: pipe(Schema.unknown, Schema.nullable),
  logs: pipe(Schema.unknown, Schema.nullable),
  metrics: Schema.unknown,
});

export interface CreatePredictionResponse
  extends Schema.Infer<typeof CreatePredictionResponse> { }

const GetPredictionResponse = Schema.struct({
  id: Schema.string,
  version: Schema.string,
  urls: Schema.struct({
    get: Schema.string,
    cancel: Schema.string,
  }),
  created_at: pipe(Schema.string, Schema.nullable),
  started_at: pipe(Schema.string, Schema.nullable),
  completed_at: pipe(Schema.string, Schema.nullable),
  source: Schema.string,
  status: Schema.string,
  input: Schema.struct({
    prompt: Schema.string,
    image: Schema.string,
  }),
  output: pipe(Schema.array(Schema.string), Schema.nullable),
  error: Schema.unknown,
  logs: Schema.unknown,
  metrics: Schema.unknown,
});

export interface GetPredictionResponse
  extends Schema.Infer<typeof GetPredictionResponse> { }

export class GenerateTimeoutError {
  readonly _tag = 'GenerateTimeoutError';
}

export interface GenerateResponse {
  generated: string;
}

export interface ReplicateClient {
  generate: ({
    a_prompt,
    detect_resolution,
    imageUrl,
    n_prompt,
    prompt,
    version,
  }: {
    imageUrl: string;
    prompt: string;
    a_prompt: string;
    n_prompt: string;
    version: string;
    detect_resolution?: number;
  }) => T.Effect<never, ClientRequestError, GenerateResponse>;
}

export const makeClient = () => {
  return T.gen(function* ($) {
    const key = yield* $(ConfigProvider.fromEnv().load(REPLICATE_API_KEY));

    function generate({
      a_prompt,
      detect_resolution,
      imageUrl,
      n_prompt,
      prompt,
      version,
    }: {
      imageUrl: string;
      prompt: string;
      a_prompt: string;
      n_prompt: string;
      version: string;
      detect_resolution?: number;
    }) {
      return pipe(
        Fetch.request<CreatePredictionResponse>(
          'https://api.replicate.com/v1/predictions',
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Token ${key}`,
            },
            data: {
              version,
              input: {
                image: imageUrl,
                prompt,
                a_prompt,
                n_prompt,
                detect_resolution,
              },
            },
          }
        ),
        T.flatMap((_) => {
          return pipe(
            T.fromEither(SchemaParser.decode(CreatePredictionResponse)(_)),
            T.mapError((error) => new ClientResponseParseError(error))
          );
        }),
        T.flatMap((res) => {
          // polling for the result
          const endpointUrl = res.urls.get;

          const detail = (url: string) => {
            return Fetch.request<GetPredictionResponse>(url, {
              method: 'GET',
              headers: {
                'Content-Type': 'application/json',
                Authorization: `Token ${key}`,
              },
            });
          };

          const loopCheckResult = (
            get: T.Effect<never, Fetch.RequestError, GetPredictionResponse>,
            check: (res: GetPredictionResponse) => boolean
          ) =>
            pipe(
              get,
              T.flatMap((res) =>
                pipe(
                  T.sync(() => !check(res)),
                  T.ifEffect(
                    T.succeed(res),
                    T.repeatUntil(
                      pipe(T.sleep(Duration.seconds(1)), T.zipRight(get)),
                      (_) => !check(_)
                    )
                  )
                )
              )
            );

          return pipe(
            loopCheckResult(detail(endpointUrl), (res) => {
              console.log('check detail, status: ', res.status);

              return res.status !== 'succeeded' && res.status !== 'failed';
            }),
            T.timeoutFail(
              () => new GenerateTimeoutError(),
              Duration.seconds(30)
            ),
            T.map((_) => {
              return {
                generated: _.output ? _.output[1] : '',
              };
            })
          );
        }),

        T.tapError((error) => T.logError(JSON.stringify(error))),
        T.mapError((error) => {
          if (error._tag === 'ClientResponseParseError') {
            return new ClientRequestError(
              new ClientResponseParseError(error.error)
            );
          }

          return new ClientRequestError(new ServerError());
        })
      );
    }

    return {
      generate,
    } satisfies ReplicateClient;
  });
};

export const ReplicateClient = Context.Tag<ReplicateClient>();

export const live = L.effect(ReplicateClient, makeClient());

export const dummy = L.succeed(ReplicateClient, {
  generate: () =>
    T.succeed({
      generated:
        'https://upcdn.io/12a1xvS/image/uploads/2023/03/04/202204150004-qALM.jpg?w=600&h=600&fit=max&q=70',
    }),
});

export const generate = (...args: Parameters<ReplicateClient['generate']>) =>
  T.serviceWithEffect(ReplicateClient, (_) => _.generate(...args));
