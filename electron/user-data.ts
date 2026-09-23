// 数据目录必须在任何模块读取 userData 之前定下来。
//
// logger 与 settings-service 都在模块加载时就绑定 app.getPath('userData')，
// 而静态 import 的求值全部早于 main.ts 本体 —— 换目录写在 main.ts 里时，
// 它们拿到的仍是装机版目录：开发版读写的是装机版的 settings.json，
// 用户在开发版里配的密钥读不到，日志也落进装机版目录。
// 所以这段逻辑独立成模块，并且必须是 main.ts 最靠前的 import 之一。
//
// 装机版路径一个字都不能改 —— 用户升级后能不能看到自己的数据全看这个路径。
import { app } from 'electron';
import * as path from 'path';

export const isDev = !app.isPackaged;

if (isDev) {
  app.setPath('userData', path.join(app.getPath('appData'), 'zhixing-reader-dev'));
}
