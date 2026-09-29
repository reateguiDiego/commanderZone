/**
 * Exact non-prohibited mutations from the supplied multilingual moderation corpus.
 *
 * These values are matched only when they occupy the complete field. They must
 * not be converted into substring exceptions.
 */
export const CORPUS_FALSE_POSITIVE_EXPRESSIONS: ReadonlySet<string> = new Set([
  // Japanese: truncated or reversed corpus mutations.
  '鹿', 'カ', 'か', '呆', 'ホ', 'ほ', 'そ', 'ソ', 'そったれ', 'ソッタレ', 'そ野郎', 'ソ野郎',
  'の野郎', 'のやろう', '郎', 'たばれ', 'ね', 'ネ', 'ざい', 'ザい', 'もい', 'モい', 'モイ',
  'んこ', 'ンコ', 'んぽ', 'ンポ', 'ス', 'す', 'ケ', 'け', '鹿馬', 'カバ', 'かば', '呆阿', 'ホア',
  'ほあ', 'そく', 'ソク', 'そくったれ', 'ソクッタレ', 'そく野郎', 'ソク野郎', '野糞郎', 'のこ野郎',
  'のこやろう', '郎野', 'たくばれ', 'ね死', 'ねし', 'ネシ', 'ざうい', 'ザウい', 'もきい', 'モキい',
  'モキイ', 'んちこ', 'ンチコ', 'んちぽ', 'ンチポ', 'んまこ', 'ンマコ', 'スカ', 'すか', 'ケボ', 'けぼ',
  'アどホ', 'アドホ', '馬', 'バ', 'ば', '阿', 'ア', 'あ', 'く', 'ク', '野',

  // Dutch: missing-leading-character corpus mutations.
  'ut', 'lootzak', 'lootviool', 'ul', 'ullen', 'ulhannes', 'ikel', 'rut', 'oer', 'oerenzoon',
  'yfuslijer', 'eringlijer', 'ankerlijer', 'odverdomme', 'erdomme', 'erdomd', 'hit', 'chijt',
  'chijten', 'tront', 'otzak', 'otwijf', 'ot op', 'likker op', 'odemieter op', 'ukkel', 'dioot',
  'uck', 'ering', 'ukt', 'lkootzak', 'lkootviool', 'ull', 'ulllen', 'ullhannes',

  // Chinese: truncated or reversed corpus mutations.
  '笔', '筆', '比', '货', '貨', '痴', '蛋', '八蛋', '你妈', '你媽', '的', '屎',
  '娘养的', '娘養的', '人', '子', '子养的', '子養的', '死', '屁', '话', '話', '八羔子', '雜種',
  '逼傻', '逼傻玩意', '屄傻', '笔煞', '筆煞', '比沙', '货蠢', '貨蠢', '痴白', '蛋笨', '蛋混', '八王蛋',
  '妈他的', '媽他的', '妈你的', '媽你的', '你操妈', '你操媽', '你草妈', '你草媽', '你肏妈', '你肏媽',
  '的妈', '的媽', '屎狗', '娘狗养的', '娘狗養的', '人贱', '人賤', '子婊', '子婊养的', '子婊養的',
  '蛋滚', '蛋滾', '死去', '屁放', '话屁', '話屁', '八王羔子', '杂狗种', '雜狗種',

  // German, French, and Italian: incomplete or transposed corpus mutations.
  'cheiße', 'cheisse', 'cheiß', 'cheiss', 'rschloch', 'rsch', 'ichser', 'ichserin', 'urensohn', 'ure',
  'chlampe', 'otze',
  'erde', 'utain', 'ute', 'onnard', 'onnasse', 'on', 'onne', 'alaud', 'alope', 'alopard', 'nculé',
  'nculée', 'a te faire enculer', 'ique ta mère', 'ique', 'iquer', 'ordel', 'ouilles', 'ite', 'ouillon',
  'ouillonne', 'ranleur', 'ranleuse', 'a gueule', 'ait chier', 'outre', 'emrde',
  'azzo', 'azzi', 'azzata', 'azzate', 'erda', 'tronzo', 'tronza', 'tronzata', 'affanculo',
]);
