export { runScan, type ScanDeps, type ScanOutcome } from './pipeline/run-scan';
export { createScanWorker, type ScanJobData } from './worker';
export { loadScannerConfig, type ScannerConfig } from './config';
export { loadDomChecksBundle } from './checks/dom';
export { createLocalStorage } from './storage';
