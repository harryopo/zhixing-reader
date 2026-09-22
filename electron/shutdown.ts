/**
 * shutdown — 退出前的统一收尾（before-quit 与「重启安装」共用一份）
 *
 * 为什么单独成模块：`app.exit()` 既不触发 before-quit，也不触发窗口 close，
 * 而「重启安装」那条路必须用 exit 才能赶在安装进程的 taskkill 循环之前消失。
 * 两条退出路各自写一遍收尾，迟早有一条漏掉某一步 —— 漏掉的那一步是丢数据。
 */
import { closeDatabase } from './database';
import { cancelActiveStream } from './ai-sdk-service';
import { logger } from './logger';
import { knowledgeCardService } from './services/knowledge-card-service';
import { stopWereadAutoSync } from './weread-sync-manager';

let done = false;

/** 幂等：窗口 close 之后 before-quit 再跑一遍也不会重复关库。 */
export function shutdownForExit(): void {
  if (done) return;
  done = true;
  logger.info('App quitting...');
  // 先掐掉进行中的 AI 流：进程随时会没，请求继续跑就是白烧 token
  cancelActiveStream();
  stopWereadAutoSync();
  knowledgeCardService.shutdown();
  // closeDatabase 内部先 forceSaveDatabase（同步写文件）再关连接
  closeDatabase();
  logger.close();
}
