import '../finance.js';
import './backend.js';
const env = Deno.env.toObject();
Deno.serve(globalThis.makeBackend(env));
