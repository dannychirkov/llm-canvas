import { withApiBoundary } from "@/lib/apiBoundary"
import type { NextRequest } from "next/server"
import { summaryRoute } from "@/lib/providers/summaryRoute"

async function boundaryPOST(request: NextRequest) {
  return summaryRoute(request, false)
}

export function POST(request: NextRequest) {
  return withApiBoundary(request, () => boundaryPOST(request))
}
