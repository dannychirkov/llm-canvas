import { requestOriginFailure } from "./requestOrigin"

/** Run before body reads/admission. API routes bypass the body-buffering proxy. */
export function withApiBoundary(request: Request, operation: () => Promise<Response> | Response): Promise<Response> {
  const failure = requestOriginFailure(request)
  return failure ? Promise.resolve(failure) : Promise.resolve().then(operation)
}
