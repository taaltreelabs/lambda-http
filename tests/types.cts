import { createHttp } from '@taaltreelabs/lambda-http';
const response: string = createHttp({ payloadVersion: '1.0' }).json({ ok: true }).body;
void response;
