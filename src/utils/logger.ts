// src/utils/logger.ts
import chalk from 'chalk';

export const logger = {
  info: (msg: string) => console.log(chalk.blue(msg)),
  error: (msg: string) => console.error(chalk.red(msg)),
  warn: (msg: string) => console.warn(chalk.yellow(msg)),
  success: (msg: string) => console.log(chalk.green(msg)),
};