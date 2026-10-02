import { createHttp } from '@taaltreelabs/lambda-http';
import type { APIGatewayProxyEvent, APIGatewayProxyEventV2, APIGatewayProxyHandler, APIGatewayProxyHandlerV2, Context } from 'aws-lambda';
const v1 = createHttp({ payloadVersion: '1.0' });
const v2 = createHttp({ payloadVersion: '2.0' });
const handler1: APIGatewayProxyHandler = v1.handle((event: APIGatewayProxyEvent, context: Context) => v1.json({ id: context.awsRequestId, parsed: v1.parseJson(event) }));
const handler2: APIGatewayProxyHandlerV2 = v2.handle((event: APIGatewayProxyEventV2) => v2.json(v2.parseJson(event)));
void [handler1, handler2];
// @ts-expect-error Parsers return unknown, never an unvalidated business type.
const input: { name: string } = v1.parseJson({ body: '{}' });
// @ts-expect-error An explicit response is required.
v1.handle(() => ({ message: 'not a response' }));
// @ts-expect-error V1 responses do not expose v2 cookies.
v1.json({}).cookies;
// @ts-expect-error V2 responses do not expose v1 multi-value headers.
v2.json({}).multiValueHeaders;
