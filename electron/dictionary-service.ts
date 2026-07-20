import * as path from 'path';
import * as fs from 'fs';
import { app } from 'electron';
import { logger } from './logger';

// 词典条目接口
export interface DictEntry {
  word: string;
  phonetic: string;
  pos: string;
  translation: string;
  collins: number;
  oxford: number;
  tag: string;
  exchange: string;
  definition?: string;
  bnc?: number;
  frq?: number;
}

// 内置词典数据（最高频词，无需加载JSON即可使用）
const BUILT_IN_DICTIONARY: Record<string, DictEntry> = {
  'recognize': { word: 'recognize', phonetic: '/ˈrekəɡnaɪz/', pos: 'v.', translation: '认出；认识到；承认', collins: 4, oxford: 1, tag: 'cet4 cet6', exchange: 'd:recognized/p:recognized/3:recognizes/i:recognizing' },
  'perspective': { word: 'perspective', phonetic: '/pərˈspektɪv/', pos: 'n.', translation: '观点；视角；透视法', collins: 4, oxford: 1, tag: 'cet4 cet6', exchange: '' },
  'empathy': { word: 'empathy', phonetic: '/ˈempəθi/', pos: 'n.', translation: '同理心；移情作用', collins: 3, oxford: 0, tag: 'cet6', exchange: '' },
  'cognitive': { word: 'cognitive', phonetic: '/ˈkɑːɡnətɪv/', pos: 'adj.', translation: '认知的；认识的', collins: 3, oxford: 1, tag: 'cet6', exchange: '' },
  'prefrontal': { word: 'prefrontal', phonetic: '/priːˈfrʌntl/', pos: 'adj.', translation: '前额的；额叶前部的', collins: 0, oxford: 0, tag: '', exchange: '' },
  'cortex': { word: 'cortex', phonetic: '/ˈkɔːrteks/', pos: 'n.', translation: '皮层；皮质', collins: 0, oxford: 0, tag: '', exchange: '' },
  'temporal': { word: 'temporal', phonetic: '/ˈtempərəl/', pos: 'adj.', translation: '时间的；颞的；世俗的', collins: 3, oxford: 1, tag: 'cet6', exchange: '' },
  'parietal': { word: 'parietal', phonetic: '/pəˈraɪətl/', pos: 'adj.', translation: '顶骨的；体壁的', collins: 0, oxford: 0, tag: '', exchange: '' },
  'junction': { word: 'junction', phonetic: '/ˈdʒʌŋkʃn/', pos: 'n.', translation: '连接；交叉点；接合处', collins: 3, oxford: 1, tag: 'cet6', exchange: '' },
  'habits': { word: 'habits', phonetic: '/ˈhæbɪts/', pos: 'n.', translation: '习惯；习性（habit的复数）', collins: 4, oxford: 1, tag: 'cet4', exchange: '' },
  'automatic': { word: 'automatic', phonetic: '/ˌɔːtəˈmætɪk/', pos: 'adj. n.', translation: '自动的；无意识的；自动装置', collins: 4, oxford: 1, tag: 'cet4 cet6', exchange: '' },
  'conscious': { word: 'conscious', phonetic: '/ˈkɑːnʃəs/', pos: 'adj.', translation: '意识到的；故意的；神志清醒的', collins: 4, oxford: 1, tag: 'cet4 cet6', exchange: '' },
  'trigger': { word: 'trigger', phonetic: '/ˈtrɪɡər/', pos: 'n. v.', translation: '触发器；引起；触发', collins: 4, oxford: 1, tag: 'cet6', exchange: '' },
  'routine': { word: 'routine', phonetic: '/ruːˈtiːn/', pos: 'n. adj.', translation: '常规；日常的；例行的', collins: 4, oxford: 1, tag: 'cet4 cet6', exchange: '' },
  'reward': { word: 'reward', phonetic: '/rɪˈwɔːrd/', pos: 'n. v.', translation: '奖励；报酬；奖赏', collins: 4, oxford: 1, tag: 'cet4 cet6', exchange: '' },
  'neurological': { word: 'neurological', phonetic: '/ˌnʊrəˈlɑːdʒɪkl/', pos: 'adj.', translation: '神经学的；神经系统的', collins: 0, oxford: 0, tag: '', exchange: '' },
  'shift': { word: 'shift', phonetic: '/ʃɪft/', pos: 'n. v.', translation: '转变；轮班；移动', collins: 5, oxford: 1, tag: 'cet4 cet6', exchange: '' },
  'effortless': { word: 'effortless', phonetic: '/ˈefərtləs/', pos: 'adj.', translation: '不费力的；容易的', collins: 3, oxford: 0, tag: 'cet6', exchange: '' },
  'consistency': { word: 'consistency', phonetic: '/kənˈsɪstənsi/', pos: 'n.', translation: '一致性；连贯性；稠度', collins: 3, oxford: 1, tag: 'cet6', exchange: '' },
  'intensity': { word: 'intensity', phonetic: '/ɪnˈtensəti/', pos: 'n.', translation: '强度；强烈；紧张', collins: 4, oxford: 1, tag: 'cet4 cet6', exchange: '' },
  'algorithm': { word: 'algorithm', phonetic: '/ˈælɡərɪðəm/', pos: 'n.', translation: '算法；运算法则', collins: 3, oxford: 0, tag: 'cet6', exchange: '' },
  'perceive': { word: 'perceive', phonetic: '/pərˈsiːv/', pos: 'v.', translation: '感知；察觉；理解', collins: 4, oxford: 1, tag: 'cet4 cet6', exchange: 'd:perceived/p:perceived/3:perceives/i:perceiving' },
  'stimuli': { word: 'stimuli', phonetic: '/ˈstɪmjəlaɪ/', pos: 'n.', translation: '刺激；刺激物（stimulus的复数）', collins: 2, oxford: 0, tag: 'cet6', exchange: '' },
  'sensory': { word: 'sensory', phonetic: '/ˈsensəri/', pos: 'adj.', translation: '感觉的；感官的', collins: 3, oxford: 1, tag: 'cet6', exchange: '' },
  'visual': { word: 'visual', phonetic: '/ˈvɪʒuəl/', pos: 'adj. n.', translation: '视觉的；视力的；画面', collins: 4, oxford: 1, tag: 'cet4 cet6', exchange: '' },
  'auditory': { word: 'auditory', phonetic: '/ˈɔːdətɔːri/', pos: 'adj.', translation: '听觉的；耳的', collins: 2, oxford: 0, tag: 'cet6', exchange: '' },
  'olfactory': { word: 'olfactory', phonetic: '/ɑːlˈfæktəri/', pos: 'adj.', translation: '嗅觉的', collins: 0, oxford: 0, tag: '', exchange: '' },
  'tactile': { word: 'tactile', phonetic: '/ˈtæktl/', pos: 'adj.', translation: '触觉的；有触觉的', collins: 2, oxford: 0, tag: 'cet6', exchange: '' },
  'peripheral': { word: 'peripheral', phonetic: '/pəˈrɪfərəl/', pos: 'adj. n.', translation: '周围的；次要的；外围设备', collins: 3, oxford: 1, tag: 'cet6', exchange: '' },
  'neurons': { word: 'neurons', phonetic: '/ˈnʊrɑːnz/', pos: 'n.', translation: '神经元（neuron的复数）', collins: 0, oxford: 0, tag: '', exchange: '' },
  'synaptic': { word: 'synaptic', phonetic: '/sɪˈnæptɪk/', pos: 'adj.', translation: '突触的', collins: 0, oxford: 0, tag: '', exchange: '' },
  'plasticity': { word: 'plasticity', phonetic: '/plæˈstɪsəti/', pos: 'n.', translation: '可塑性；适应性', collins: 0, oxford: 0, tag: '', exchange: '' },
  'encodes': { word: 'encodes', phonetic: '/ɪnˈkoʊdz/', pos: 'v.', translation: '编码；译码（encode的第三人称单数）', collins: 0, oxford: 0, tag: '', exchange: '' },
  'retrieval': { word: 'retrieval', phonetic: '/rɪˈtriːvl/', pos: 'n.', translation: '检索；恢复；取回', collins: 3, oxford: 1, tag: 'cet6', exchange: '' },
  'consolidation': { word: 'consolidation', phonetic: '/kənˌsɑːlɪˈdeɪʃn/', pos: 'n.', translation: '巩固；合并；联合', collins: 2, oxford: 0, tag: 'cet6', exchange: '' },
  'decay': { word: 'decay', phonetic: '/dɪˈkeɪ/', pos: 'n. v.', translation: '衰退；腐烂；腐朽', collins: 3, oxford: 1, tag: 'cet6', exchange: '' },
  'rehearsal': { word: 'rehearsal', phonetic: '/rɪˈhɜːrsl/', pos: 'n.', translation: '排练；预演；复述', collins: 3, oxford: 1, tag: 'cet6', exchange: '' },
  'mnemonic': { word: 'mnemonic', phonetic: '/nɪˈmɑːnɪk/', pos: 'adj. n.', translation: '记忆的；助记符', collins: 0, oxford: 0, tag: '', exchange: '' },
  'chunking': { word: 'chunking', phonetic: '/ˈtʃʌŋkɪŋ/', pos: 'n.', translation: '组块；分组', collins: 0, oxford: 0, tag: '', exchange: '' },
  'elaborative': { word: 'elaborative', phonetic: '/ɪˈlæbərətɪv/', pos: 'adj.', translation: '精心制作的；详尽的', collins: 0, oxford: 0, tag: '', exchange: '' },
  'metacognition': { word: 'metacognition', phonetic: '/ˌmetəkɑːɡˈnɪʃn/', pos: 'n.', translation: '元认知', collins: 0, oxford: 0, tag: '', exchange: '' },
  'introspection': { word: 'introspection', phonetic: '/ˌɪntrəˈspekʃn/', pos: 'n.', translation: '内省；自省；反思', collins: 2, oxford: 0, tag: 'cet6', exchange: '' },
  'mindfulness': { word: 'mindfulness', phonetic: '/ˈmaɪndfʊlnəs/', pos: 'n.', translation: '正念；专注', collins: 0, oxford: 0, tag: '', exchange: '' },
  'meditation': { word: 'meditation', phonetic: '/ˌmedɪˈteɪʃn/', pos: 'n.', translation: '冥想；沉思；默想', collins: 3, oxford: 1, tag: 'cet6', exchange: '' },
  'contemplation': { word: 'contemplation', phonetic: '/ˌkɑːntəmˈpleɪʃn/', pos: 'n.', translation: '沉思；注视；意图', collins: 2, oxford: 0, tag: 'cet6', exchange: '' },
  'resilience': { word: 'resilience', phonetic: '/rɪˈzɪliəns/', pos: 'n.', translation: '恢复力；弹性；适应力', collins: 3, oxford: 0, tag: 'cet6', exchange: '' },
  'grit': { word: 'grit', phonetic: '/ɡrɪt/', pos: 'n. v.', translation: '勇气；砂砾；咬紧牙关', collins: 2, oxford: 0, tag: '', exchange: '' },
  'perseverance': { word: 'perseverance', phonetic: '/ˌpɜːrsəˈvɪrəns/', pos: 'n.', translation: '毅力；坚持不懈', collins: 3, oxford: 1, tag: 'cet6', exchange: '' },
  'motivation': { word: 'motivation', phonetic: '/ˌmoʊtɪˈveɪʃn/', pos: 'n.', translation: '动机；动力；积极性', collins: 4, oxford: 1, tag: 'cet4 cet6', exchange: '' },
  'discipline': { word: 'discipline', phonetic: '/ˈdɪsəplɪn/', pos: 'n. v.', translation: '纪律；学科；训练；惩罚', collins: 5, oxford: 1, tag: 'cet4 cet6', exchange: '' },
  'procrastination': { word: 'procrastination', phonetic: '/prəˌkræstɪˈneɪʃn/', pos: 'n.', translation: '拖延；耽搁', collins: 0, oxford: 0, tag: '', exchange: '' },
  'temptation': { word: 'temptation', phonetic: '/tempˈteɪʃn/', pos: 'n.', translation: '诱惑；引诱物', collins: 3, oxford: 1, tag: 'cet4 cet6', exchange: '' },
  'willpower': { word: 'willpower', phonetic: '/ˈwɪlpaʊər/', pos: 'n.', translation: '意志力；毅力', collins: 0, oxford: 0, tag: '', exchange: '' },
  'impulse': { word: 'impulse', phonetic: '/ˈɪmpʌls/', pos: 'n.', translation: '冲动；脉冲；推动力', collins: 4, oxford: 1, tag: 'cet6', exchange: '' },
  'inhibition': { word: 'inhibition', phonetic: '/ˌɪnhɪˈbɪʃn/', pos: 'n.', translation: '抑制；禁止；拘谨', collins: 2, oxford: 0, tag: 'cet6', exchange: '' },
  'dopamine': { word: 'dopamine', phonetic: '/ˈdoʊpəmiːn/', pos: 'n.', translation: '多巴胺', collins: 0, oxford: 0, tag: '', exchange: '' },
  'serotonin': { word: 'serotonin', phonetic: '/ˌserəˈtoʊnɪn/', pos: 'n.', translation: '血清素；5-羟色胺', collins: 0, oxford: 0, tag: '', exchange: '' },
  'endorphins': { word: 'endorphins', phonetic: '/enˈdɔːrfɪnz/', pos: 'n.', translation: '内啡肽；脑内啡', collins: 0, oxford: 0, tag: '', exchange: '' },
  'cortisol': { word: 'cortisol', phonetic: '/ˈkɔːrtɪsɔːl/', pos: 'n.', translation: '皮质醇', collins: 0, oxford: 0, tag: '', exchange: '' },
  'amygdala': { word: 'amygdala', phonetic: '/əˈmɪɡdələ/', pos: 'n.', translation: '杏仁核', collins: 0, oxford: 0, tag: '', exchange: '' },
  'hippocampus': { word: 'hippocampus', phonetic: '/ˌhɪpəˈkæmpəs/', pos: 'n.', translation: '海马体', collins: 0, oxford: 0, tag: '', exchange: '' },
  'neuroplasticity': { word: 'neuroplasticity', phonetic: '/ˌnʊroʊplæˈstɪsəti/', pos: 'n.', translation: '神经可塑性', collins: 0, oxford: 0, tag: '', exchange: '' },
  'psychology': { word: 'psychology', phonetic: '/saɪˈkɑːlədʒi/', pos: 'n.', translation: '心理学；心理状态', collins: 5, oxford: 1, tag: 'cet4 cet6', exchange: '' },
  'sociology': { word: 'sociology', phonetic: '/ˌsoʊsiˈɑːlədʒi/', pos: 'n.', translation: '社会学', collins: 4, oxford: 1, tag: 'cet6', exchange: '' },
  'anthropology': { word: 'anthropology', phonetic: '/ˌænθrəˈpɑːlədʒi/', pos: 'n.', translation: '人类学', collins: 3, oxford: 0, tag: 'cet6', exchange: '' },
  'philosophy': { word: 'philosophy', phonetic: '/fɪˈlɑːsəfi/', pos: 'n.', translation: '哲学；哲理；人生观', collins: 5, oxford: 1, tag: 'cet4 cet6', exchange: '' },
  'neuroscience': { word: 'neuroscience', phonetic: '/ˈnʊroʊsaɪəns/', pos: 'n.', translation: '神经科学', collins: 0, oxford: 0, tag: '', exchange: '' },
  'behavioral': { word: 'behavioral', phonetic: '/bɪˈheɪvjərəl/', pos: 'adj.', translation: '行为的', collins: 0, oxford: 0, tag: '', exchange: '' },
  'empirical': { word: 'empirical', phonetic: '/ɪmˈpɪrɪkl/', pos: 'adj.', translation: '经验主义的；以观察为依据的', collins: 3, oxford: 1, tag: 'cet6', exchange: '' },
  'hypothesis': { word: 'hypothesis', phonetic: '/haɪˈpɑːθəsɪs/', pos: 'n.', translation: '假设；假说', collins: 4, oxford: 1, tag: 'cet6', exchange: '' },
  'variable': { word: 'variable', phonetic: '/ˈveriəbl/', pos: 'n. adj.', translation: '变量；可变的；易变的', collins: 4, oxford: 1, tag: 'cet4 cet6', exchange: '' },
  'correlation': { word: 'correlation', phonetic: '/ˌkɔːrəˈleɪʃn/', pos: 'n.', translation: '相关；关联；相关系数', collins: 3, oxford: 1, tag: 'cet6', exchange: '' },
  'causation': { word: 'causation', phonetic: '/kɔːˈzeɪʃn/', pos: 'n.', translation: '因果关系；原因', collins: 2, oxford: 0, tag: '', exchange: '' },
  'experiment': { word: 'experiment', phonetic: '/ɪkˈsperɪmənt/', pos: 'n. v.', translation: '实验；试验；尝试', collins: 5, oxford: 1, tag: 'cet4 cet6', exchange: '' },
  'phenomenon': { word: 'phenomenon', phonetic: '/fɪˈnɑːmɪnən/', pos: 'n.', translation: '现象；杰出的人', collins: 4, oxford: 1, tag: 'cet4 cet6', exchange: '' },
  'paradigm': { word: 'paradigm', phonetic: '/ˈpærədaɪm/', pos: 'n.', translation: '范例；模范；词形变化表', collins: 3, oxford: 1, tag: 'cet6', exchange: '' },
  'framework': { word: 'framework', phonetic: '/ˈfreɪmwɜːrk/', pos: 'n.', translation: '框架；结构；体系', collins: 4, oxford: 1, tag: 'cet4 cet6', exchange: '' },
  'methodology': { word: 'methodology', phonetic: '/ˌmeθəˈdɑːlədʒi/', pos: 'n.', translation: '方法论；一套方法', collins: 3, oxford: 1, tag: 'cet6', exchange: '' },
  'technique': { word: 'technique', phonetic: '/tekˈniːk/', pos: 'n.', translation: '技术；技巧；技能', collins: 5, oxford: 1, tag: 'cet4 cet6', exchange: '' },
  'strategy': { word: 'strategy', phonetic: '/ˈstrætədʒi/', pos: 'n.', translation: '策略；战略', collins: 5, oxford: 1, tag: 'cet4 cet6', exchange: '' },
  'approach': { word: 'approach', phonetic: '/əˈproʊtʃ/', pos: 'n. v.', translation: '方法；接近；靠近', collins: 5, oxford: 1, tag: 'cet4 cet6', exchange: '' },
  'mechanism': { word: 'mechanism', phonetic: '/ˈmekənɪzəm/', pos: 'n.', translation: '机制；原理；途径', collins: 4, oxford: 1, tag: 'cet4 cet6', exchange: '' },
  'process': { word: 'process', phonetic: '/ˈprɑːses/', pos: 'n. v.', translation: '过程；加工；处理', collins: 5, oxford: 1, tag: 'cet4 cet6', exchange: '' },
  'concept': { word: 'concept', phonetic: '/ˈkɑːnsept/', pos: 'n.', translation: '概念；观念；想法', collins: 5, oxford: 1, tag: 'cet4 cet6', exchange: '' },
  'theory': { word: 'theory', phonetic: '/ˈθɪəri/', pos: 'n.', translation: '理论；学说；原理', collins: 5, oxford: 1, tag: 'cet4 cet6', exchange: '' },
  'principle': { word: 'principle', phonetic: '/ˈprɪnsəpl/', pos: 'n.', translation: '原则；原理；道义', collins: 5, oxford: 1, tag: 'cet4 cet6', exchange: '' },
  'insight': { word: 'insight', phonetic: '/ˈɪnsaɪt/', pos: 'n.', translation: '洞察力；见解；深刻理解', collins: 4, oxford: 1, tag: 'cet6', exchange: '' },
  'intuition': { word: 'intuition', phonetic: '/ˌɪntuˈɪʃn/', pos: 'n.', translation: '直觉；直觉力', collins: 3, oxford: 1, tag: 'cet6', exchange: '' },
  'awareness': { word: 'awareness', phonetic: '/əˈwernəs/', pos: 'n.', translation: '意识；认识；知道', collins: 4, oxford: 1, tag: 'cet6', exchange: '' },
  'consciousness': { word: 'consciousness', phonetic: '/ˈkɑːnʃəsnəs/', pos: 'n.', translation: '意识；知觉；觉悟', collins: 4, oxford: 1, tag: 'cet6', exchange: '' },
  'subconscious': { word: 'subconscious', phonetic: '/ˌsʌbˈkɑːnʃəs/', pos: 'adj. n.', translation: '潜意识的；下意识', collins: 3, oxford: 0, tag: 'cet6', exchange: '' },
  'unconscious': { word: 'unconscious', phonetic: '/ʌnˈkɑːnʃəs/', pos: 'adj. n.', translation: '无意识的；失去知觉的', collins: 4, oxford: 1, tag: 'cet4 cet6', exchange: '' },
};

// 词形变化解析：exchange 格式为 "d:did/p:done/3:does/i:doing/s:does/0:do"
// d:过去式, p:过去分词, 3:三单, i:现在分词, s:复数, 0:原形, r:比较级, t:最高级
interface _ExchangeForms {
  [form: string]: string;  // 变形 -> 原形
}

// 词典服务类
class DictionaryService {
  private dictionary: Map<string, DictEntry> = new Map();
  private exchangeMap: Map<string, string> = new Map(); // 变形 -> 原形
  private initialized = false;
  private jsonPath: string;
  private builtInSize: number;

  constructor() {
    this.jsonPath = this.getJsonPath();
    this.builtInSize = Object.keys(BUILT_IN_DICTIONARY).length;
    // 先加载内置词典以确保基础功能可用
    this.initBuiltInDictionary();
    // 异步加载完整词典
    this.loadJsonDictionary();
  }

  private getJsonPath(): string {
    try {
      if (app?.isPackaged) {
        return path.join(process.resourcesPath, 'dictionary.json');
      }
      // 开发/预览模式：优先从项目根目录 resources 加载
      const rootResourcesPath = path.join(__dirname, '..', '..', 'resources', 'dictionary.json');
      if (fs.existsSync(rootResourcesPath)) {
        return rootResourcesPath;
      }
      return path.join(__dirname, '..', 'resources', 'dictionary.json');
    } catch {
      return path.join(__dirname, '..', 'resources', 'dictionary.json');
    }
  }

  private initBuiltInDictionary(): void {
    for (const [word, entry] of Object.entries(BUILT_IN_DICTIONARY)) {
      const lower = word.toLowerCase();
      this.dictionary.set(lower, entry);
      // 构建词形变化索引
      this.addExchangeIndex(entry);
    }
  }

  private async loadJsonDictionary(): Promise<void> {
    try {
      if (!fs.existsSync(this.jsonPath)) {
        logger.warn(`dictionary.json not found at ${this.jsonPath}, run scripts/extract-dictionary.js first`);
        this.initialized = true;
        return;
      }

      const startTime = Date.now();
      const raw = fs.readFileSync(this.jsonPath, 'utf-8');
      const data = JSON.parse(raw) as Record<string, Record<string, unknown>>;
      const _entries = Object.keys(data);
      let loaded = 0;

      for (const [word, rawEntry] of Object.entries(data)) {
        // 跳过内置词典中已有的词
        if (this.dictionary.has(word.toLowerCase())) continue;

        const entry: DictEntry = {
          word: String(rawEntry.word || word),
          phonetic: String(rawEntry.phonetic || ''),
          pos: String(rawEntry.pos || ''),
          translation: String(rawEntry.translation || ''),
          collins: Number(rawEntry.collins || 0),
          oxford: Number(rawEntry.oxford || 0),
          tag: String(rawEntry.tag || ''),
          exchange: String(rawEntry.exchange || ''),
          definition: rawEntry.definition ? String(rawEntry.definition) : undefined,
          bnc: rawEntry.bnc ? Number(rawEntry.bnc) : undefined,
          frq: rawEntry.frq ? Number(rawEntry.frq) : undefined,
        };

        this.dictionary.set(word.toLowerCase(), entry);
        this.addExchangeIndex(entry);
        loaded++;
      }

      this.initialized = true;
      logger.info(`Dictionary loaded: ${loaded} entries from JSON + ${this.builtInSize} built-in, took ${Date.now() - startTime}ms`);
    } catch (error) {
      logger.error('Failed to load dictionary JSON', { error: String(error) });
      this.initialized = true; // 即使失败也可以使用内置词典
    }
  }

  // 解析 exchange 字段并建立变形 -> 原形索引
  private addExchangeIndex(entry: DictEntry): void {
    if (!entry.exchange || entry.exchange.trim() === '') return;

    // exchange 格式: "d:did/p:done/3:does/i:doing/s:does/0:do/r:better/t:best"
    const parts = entry.exchange.split('/');
    for (const part of parts) {
      const colonIdx = part.indexOf(':');
      if (colonIdx === -1) continue;
      const form = part.substring(colonIdx + 1).trim().toLowerCase();
      if (form && form !== entry.word.toLowerCase()) {
        // 只添加不冲突的映射
        if (!this.exchangeMap.has(form)) {
          this.exchangeMap.set(form, entry.word.toLowerCase());
        }
      }
    }
  }

  // 主查询方法（同步，因为词典数据全部在内存中）
  lookup(word: string): DictEntry | null {
    const normalizedWord = word.toLowerCase().trim();
    if (normalizedWord.length < 2) return null;

    // 1. 精确匹配
    const exactMatch = this.dictionary.get(normalizedWord);
    if (exactMatch) return exactMatch;

    // 2. 词形变化查询（如 "recognized" -> "recognize"）
    const baseForm = this.exchangeMap.get(normalizedWord);
    if (baseForm) {
      const baseEntry = this.dictionary.get(baseForm);
      if (baseEntry) return baseEntry;
    }

    // 3. 词干还原（多种策略）
    const derived = this.deriveBaseForm(normalizedWord);
    if (derived !== normalizedWord) {
      const derivedMatch = this.dictionary.get(derived);
      if (derivedMatch) return derivedMatch;
    }

    return null;
  }

  // 批量查询
  lookupBatch(words: string[]): Map<string, DictEntry | null> {
    const results = new Map<string, DictEntry | null>();
    for (const word of words) {
      const result = this.lookup(word);
      results.set(word, result);
    }
    return results;
  }

  // 简单词干还原
  private simpleStem(word: string): string {
    const suffixes = ['ing', 'tion', 'ness', 'ment', 'able', 'ful', 'less', 'ous', 'ive', 'ly', 'er', 'est', 'ed', 'es', 's'];
    for (const suffix of suffixes) {
      if (word.endsWith(suffix) && word.length > suffix.length + 3) {
        const stem = word.slice(0, -suffix.length);
        if (this.dictionary.has(stem)) return stem;
      }
    }
    return word;
  }

  // 动词/名词/形容词变形还原（综合所有策略）
  private deriveBaseForm(word: string): string {
    // 策略0: -ies → -y (studies → study, abilities → ability)
    if (word.endsWith('ies') && word.length > 4) {
      const base = word.slice(0, -3) + 'y';
      if (this.dictionary.has(base)) return base;
    }

    // 策略1: -ves → -f (leaves → leaf, wolves → wolf)
    if (word.endsWith('ves') && word.length > 4) {
      const base = word.slice(0, -3) + 'f';
      if (this.dictionary.has(base)) return base;
      const baseFe = word.slice(0, -3) + 'fe';
      if (this.dictionary.has(baseFe)) return baseFe;
    }

    // 策略2: -ing 形式 (running → run, making → make)
    if (word.endsWith('ing') && word.length > 4) {
      const base = word.slice(0, -3);
      if (this.dictionary.has(base)) return base;
      // 双写辅音: running → run
      if (base.length > 2 && base[base.length - 1] === base[base.length - 2]) {
        const single = base.slice(0, -1);
        if (this.dictionary.has(single)) return single;
      }
      // 去e加ing: making → make
      const withE = base + 'e';
      if (this.dictionary.has(withE)) return withE;
    }

    // 策略3: -ed 形式 (stopped → stop, studied → study, loved → love)
    if (word.endsWith('ed') && word.length > 3) {
      const base = word.slice(0, -2);
      if (this.dictionary.has(base)) return base;
      // 去y变ied: studied → study
      const yForm = base + 'y';
      if (this.dictionary.has(yForm)) return yForm;
      // 双写辅音: stopped → stop
      if (base.length > 2 && base[base.length - 1] === base[base.length - 2]) {
        const single = base.slice(0, -1);
        if (this.dictionary.has(single)) return single;
      }
      // 只加d: loved → love
      const withE = base + 'e';
      if (this.dictionary.has(withE)) return withE;
    }

    // 策略4: -es 形式 (watches → watch, boxes → box)
    // 注意：先尝试 -s（对 sees→see, lies→lie 更准确），再尝试 -es
    if (word.endsWith('es') && word.length > 3 && !word.endsWith('ies')) {
      // 先尝试只去掉 s（sees → see, lies → lie）
      const baseS = word.slice(0, -1);
      if (this.dictionary.has(baseS)) return baseS;
      // 再尝试去掉 es（watches → watch, boxes → box）
      const base = word.slice(0, -2);
      if (this.dictionary.has(base)) return base;
      if (base.endsWith('i')) {
        const yForm = base.slice(0, -1) + 'y';
        if (this.dictionary.has(yForm)) return yForm;
      }
    }

    // 策略5: -er 比较级 (bigger → big, easier → easy)
    if (word.endsWith('er') && word.length > 4) {
      const base = word.slice(0, -2);
      if (this.dictionary.has(base)) return base;
      // 双写辅音: bigger → big
      if (base.length > 2 && base[base.length - 1] === base[base.length - 2]) {
        const single = base.slice(0, -1);
        if (this.dictionary.has(single)) return single;
      }
      // ier → y: easier → easy
      if (base.endsWith('i')) {
        const yForm = base.slice(0, -1) + 'y';
        if (this.dictionary.has(yForm)) return yForm;
      }
    }

    // 策略6: -est 最高级 (biggest → big, easiest → easy)
    if (word.endsWith('est') && word.length > 5) {
      const base = word.slice(0, -3);
      if (this.dictionary.has(base)) return base;
      // 双写辅音: biggest → big
      if (base.length > 2 && base[base.length - 1] === base[base.length - 2]) {
        const single = base.slice(0, -1);
        if (this.dictionary.has(single)) return single;
      }
      // iest → y: easiest → easy
      if (base.endsWith('i')) {
        const yForm = base.slice(0, -1) + 'y';
        if (this.dictionary.has(yForm)) return yForm;
      }
    }

    // 策略7: -s 一般复数/三单 (最后一个尝试，避免误判)
    if (word.endsWith('s') && !word.endsWith('ss') && word.length > 2) {
      const base = word.slice(0, -1);
      if (this.dictionary.has(base)) return base;
    }

    return word;
  }

  // 获取词典大小
  getSize(): number {
    return this.dictionary.size;
  }

  // 检查是否已初始化
  isInitialized(): boolean {
    return this.initialized;
  }

  // 搜索相似单词（用于拼写建议）
  searchSimilar(word: string, limit: number = 5): DictEntry[] {
    const results: DictEntry[] = [];
    const prefix = word.toLowerCase();

    for (const [key, entry] of this.dictionary) {
      if (key.startsWith(prefix) && key.length >= prefix.length - 2 && key.length <= prefix.length + 2) {
        results.push(entry);
        if (results.length >= limit) break;
      }
    }

    return results;
  }
}

// 导出单例
export const dictionaryService = new DictionaryService();