import { pipe } from "@effect/data/Function";
import * as T from "@effect/io/Effect";
import * as Logger from "@effect/io/Logger";
import * as LoggerLevel from "@effect/io/Logger/Level";
import * as SchemaParser from "@effect/schema/Parser";
import * as Schema from "@effect/schema/Schema";
import { NextRequest, NextResponse } from "next/server";

import * as Replicate from "@/core/replicate/client";
import cors from "@/core/cors";

export const config = {
  runtime: "edge", // this is a pre-requisite
  regions: ["iad1"], // only execute this function on iad1
};

const InputPostSchema = Schema.struct({
  image: Schema.string,
  prompt: Schema.string,
});

export default async function handler(req: NextRequest) {
  let result: any = ''

  if (req.method === 'POST') {
    const program = pipe(
      SchemaParser.decode(InputPostSchema)(await req.json()),
      T.fromEither,
      T.flatMap((body) =>
        Replicate.generate({
          version:
            "854e8727697a057c525cdb45ab037f64ecca770a1769cc52287c2e56472a247b",
          a_prompt:
            "best quality, extremely detailed, photo from Pinterest, interior, ultra-detailed, award-winning, Photography, real-life",
          n_prompt:
            "longbody, lowres, bad anatomy, bad hands, missing fingers, extra digit, fewer digits, cropped, worst quality, low quality",
          imageUrl: body.image,
          prompt: body.prompt,
          detect_resolution: 1024,
        })
      ),
      Logger.withMinimumLogLevel(LoggerLevel.All),
      T.provideLayer(Replicate.live),
      T.tapDefect((_) => T.logErrorCause(_))
    );

    result = await T.runPromiseEither(program);

    console.log(result);
  }

  // cors set
  return cors(
    req,
    req.method === 'POST' ? result._tag === "Right"
      ? new NextResponse(JSON.stringify(result.right))
      : new NextResponse(null, { status: 500 }) : new NextResponse(null, { status: 405 }),
    {
      methods: ['GET', 'HEAD', 'POST', 'OPTIONS', 'PUT', 'PATCH', 'DELETE']
    }
  );
}
