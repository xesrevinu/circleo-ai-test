import { pipe } from '@effect/data/Function';
import * as T from '@effect/io/Effect';
import * as Logger from '@effect/io/Logger';
import * as LoggerLevel from '@effect/io/Logger/Level';
import * as SchemaParser from '@effect/schema/Parser';
import * as Schema from '@effect/schema/Schema';
import { NextApiRequest, NextApiResponse } from 'next';

import * as Replicate from '@/core/replicate/client';

const InputPostSchema = Schema.struct({
  image: Schema.string,
  prompt: Schema.string,
});

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<any>
) {
  const program = pipe(
    SchemaParser.decode(InputPostSchema)(req.body),
    T.fromEither,
    T.flatMap((body) =>
      Replicate.generate({
        version:
          '854e8727697a057c525cdb45ab037f64ecca770a1769cc52287c2e56472a247b',
        a_prompt:
          'best quality, extremely detailed, photo from Pinterest, interior, ultra-detailed, award-winning, Photography, real-life',
        n_prompt:
          'longbody, lowres, bad anatomy, bad hands, missing fingers, extra digit, fewer digits, cropped, worst quality, low quality',
        imageUrl: body.image,
        prompt: body.prompt,
        detect_resolution: 1024,
      })
    ),
    Logger.withMinimumLogLevel(LoggerLevel.All),
    T.provideLayer(Replicate.live),
    T.tapDefect((_) => T.logErrorCause(_))
  );

  const result = await T.runPromiseEither(program);

  if (result._tag === 'Right') {
    res.status(200).json(result.right);
  } else {
    res.status(500).end();
  }
}
