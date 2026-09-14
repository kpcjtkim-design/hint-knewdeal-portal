// Compatibility entry for browser-free ESM tests and tools. Vercel handlers import CJS directly.
export {fetchJson,createBridgeReader,readBridge,readerFailure} from './attendance-reader-transport.cjs';
