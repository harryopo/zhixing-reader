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

/**
 * 收尾里任何一步都可能抛错，而**这一步抛错不许把后面几步一起带走** ——
 * 最要命的那一步是 `closeDatabase`：它抛错正是"落盘失败"，而裸调用一旦抛出去，
 * `logger.close()` 永远轮不到，于是这次退出什么都不留痕迹：数据没落盘、
 * 退出卡住、日志里也没有"为什么"。本项目为此治过十几次，这里是同一个形状。
 *
 * 每步各自兜住并记账，全部走完之后把错误一起抛回去 —— 调用方仍会看到失败
 * （`app.exit(0)` 那一路本来就 catch 不住，但 before-quit 那一路看得到），
 * 只是"关库失败"不再等于"日志没关、蒸馏没关、同步定时器还在跑"。
 */
function runStep(label: string, step: () => void, errors: Error[]): void {
  try {
    step();
  } catch (error) {
    errors.push(error instanceof Error ? error : new Error(String(error)));
    logger.error(`Shutdown step failed: ${label}`, { error: error instanceof Error ? error.message : String(error) });
  }
}

/** 幂等：窗口 close 之后 before-quit 再跑一遍也不会重复关库。 */
export function shutdownForExit(): void {
  if (done) return;
  done = true;
  logger.info('App quitting...');
  const errors: Error[] = [];
  // 先掐掉进行中的 AI 流：进程随时会没，请求继续跑就是白烧 token
  runStep('cancelActiveStream', cancelActiveStream, errors);
  runStep('stopWereadAutoSync', stopWereadAutoSync, errors);
  runStep('knowledgeCardService.shutdown', () => knowledgeCardService.shutdown(), errors);
  // closeDatabase 内部先 forceSaveDatabase（同步写文件）再关连接
  runStep('closeDatabase', closeDatabase, errors);
  runStep('logger.close', () => logger.close(), errors);
  if (errors.length > 0) {
    throw new AggregateError(errors, `退出收尾有 ${errors.length} 步失败`)
  }
}
