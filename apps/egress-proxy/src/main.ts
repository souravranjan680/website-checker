import { pino } from 'pino';
import { loadProxyConfig } from './config';
import { createEgressProxy } from './server';

// Entry point of the egress proxy service.
const config = loadProxyConfig();
const logger = pino({
  name: 'egress-proxy',
  level: config.logLevel,
  ...(config.nodeEnv === 'development'
    ? {
        transport: {
          target: 'pino-pretty',
          options: { colorize: true, translateTime: 'HH:MM:ss' },
        },
      }
    : {}),
});

const server = createEgressProxy({ policy: config.policy, logger });
server.listen(config.port, config.host, () => {
  logger.info(
    {
      host: config.host,
      port: config.port,
      allowedPorts: config.policy.allowedPorts,
      testHosts: Object.keys(config.policy.testHostMap),
    },
    'Egress proxy listening',
  );
});

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    logger.info(`${signal} received, closing`);
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 3000).unref();
  });
}
