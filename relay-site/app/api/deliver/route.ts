import { env } from 'cloudflare:workers';
import { handleDelivery } from '@/lib/delivery.mjs';
export async function POST(request: Request) {
  return handleDelivery(request, env);
}
