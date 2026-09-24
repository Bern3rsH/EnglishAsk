import { CARD_TYPE_LABELS, INTENT_LABELS } from '../../shared/answer-tags'

const diagnosticLabels: Record<string, string> = {
  ...CARD_TYPE_LABELS,
  ...INTENT_LABELS,
  single_word: '单个词语', fixed_expression: '固定表达', complete_sentence: '完整句子',
  long_text: '长文本', abstract_concept: '抽象概念', multi_target_comparison: '多目标对比',
  meaning: '含义', phonetic: '音标', pronunciation: '发音',
  examples: '例句', usage: '用法', grammar: '语法', tense: '时态', voice: '语态',
  sentence_structure: '句子结构', word_breakdown: '词语解析', collocations: '常见搭配',
  common_mistakes: '常见错误', translation: '翻译', card: '知识卡片',
  clarification: '需要澄清', conversational: '日常交流'
}

export const getDiagnosticLabel = (value: string): string => diagnosticLabels[value] ?? value

const reviewMessages: Record<string, string> = {
  unknown: '无法核实回答中的语法。', timeout: '语法审查超过 45 秒，请重试。',
  authentication_failed: '语法审查鉴权失败，请检查 API 密钥和权限。',
  rate_limited: '语法审查请求过于频繁，请稍后重试。',
  provider_unavailable: '语法审查服务暂时不可用，请稍后重试。',
  network_failed: '无法连接语法审查服务，请检查网络。', request_failed: '语法审查请求失败，请重试。',
  invalid_json: '语法审查返回的 JSON 无效，请重试。',
  invalid_response: '语法审查返回的数据结构无效。', response_too_large: '语法审查返回的内容过长。',
  invalid_correction: '语法审查返回的修改无效。', unknown_field: '语法审查尝试修改不存在的字段。',
  duplicate_correction: '语法审查对同一字段返回了重复修改。', quote_mismatch: '语法审查引用的内容与原回答不符。',
  invalid_replacement: '语法审查返回的替换内容不符合要求。',
  invalid_reviewed_card: '语法审查后的回答未通过校验。', internal_error: '无法准备或处理语法审查请求。'
}

export const localizeInterfaceMessage = (message: string): string => {
  if (/[\u3400-\u9fff]/u.test(message)) return message
  const code = message.match(/^\[([a-z_]+)\]/)?.[1]
  if (code && reviewMessages[code]) return reviewMessages[code]
  if (/API key|API credentials|authentication|\b401\b|\b403\b/i.test(message)) return '请检查设置中的 API 密钥和访问权限。'
  if (/rate limit|\b429\b/i.test(message)) return '请求过于频繁，请稍后重试。'
  if (/timeout|timed out|time limit/i.test(message)) return '请求超时，请稍后重试。'
  if (/network|fetch failed|connect|ECONN|ENOTFOUND/i.test(message)) return '连接失败，请检查网络后重试。'
  if (/not found|ENOENT|no longer exists/i.test(message)) return '未找到所需内容，文件可能已被移动或删除。'
  if (/already exists|EEXIST/i.test(message)) return '已存在同名文件，请使用其他名称。'
  if (/EACCES|EPERM|permission/i.test(message)) return '没有访问权限，请检查文件或目录权限。'
  if (/empty response/i.test(message)) return '模型返回了空内容，请重试。'
  if (/Router|classification/i.test(message)) return '问题分类失败，请重试。'
  if (/example|translation|module|Knowledge card/i.test(message)) return '回答内容未通过格式校验，请重试。'
  if (/10 MB|2 MB/i.test(message)) return '文件过大，请缩小文件后重试。'
  if (/PNG.*JPEG.*GIF.*WebP/i.test(message)) return '仅支持 PNG、JPEG、GIF 和 WebP 图片。'
  if (/interrupted/i.test(message)) return '请求已中断，请重试。'
  return '操作未完成，请查看技术详情。'
}

export function InterfaceMessage({ message }: { message: string }) {
  const localized = localizeInterfaceMessage(message)
  return <>
    <span>{localized}</span>
    {localized !== message ? <details className="interfaceMessageDetails">
      <summary>技术详情</summary>
      <pre>{message}</pre>
    </details> : null}
  </>
}
