/**
 * The plugin's Cordis configuration schema.
 *
 * Two reasons this exists:
 *
 *   1. It documents every field in the profile's own `cordis.patch.yml`, which
 *      is where the plugin's row lives.
 *   2. Every field is `volatile()`, which is what makes the harness's own
 *      settings page able to edit them. A non-volatile field is silently absent
 *      from the generated form.
 *
 * Plain JavaScript on purpose: the host half runs through Node's TypeScript
 * type-stripping, which strips `.ts` modules only and cannot strip a `.ts`
 * module under `node_modules`. Keeping this file annotation-free means it needs
 * no build step and no stripper.
 *
 * Schemastery is imported dynamically. The profile always provides it, but the
 * plugin must still boot in a composition that does not — in that case it falls
 * back to its own JSON file at `$DSH_HOME/prompt-optimizer.json`, and the
 * plugin's own settings section keeps working.
 *
 * @module dsh-prompt-optimizer/config
 */

import { DEFAULT_SETTINGS } from './settings.ts'

/**
 * Build the schema for the plugin's configuration.
 *
 * @param z - the schemastery module.
 * @returns the schema object handed to the Loader.
 */
export function buildConfigSchema(z) {
  /**
   * A volatile string field with a description.
   *
   * `volatile()` is what makes the field editable from the harness settings
   * page; without it the field is absent from the generated form.
   */
  const field = (value, description) => z.string().default(value).volatile().description(description)

  return z.object({
    model: field(DEFAULT_SETTINGS.model, 'current = 复用当前会话模型；也可填 provider/model'),
    intensity: field(DEFAULT_SETTINGS.intensity, 'light | balanced | deep'),
    language: field(DEFAULT_SETTINGS.language, 'auto | chinese | english | original'),
    autoDetectDomain: z.boolean().default(DEFAULT_SETTINGS.autoDetectDomain).volatile().description('自动识别任务领域'),
    showPreview: z.boolean().default(DEFAULT_SETTINGS.showPreview).volatile().description('优化后先预览再写入输入框'),
    useConversationContext: z.boolean().default(DEFAULT_SETTINGS.useConversationContext).volatile().description('参考会话上下文消解指代'),
    useProjectContext: z.boolean().default(DEFAULT_SETTINGS.useProjectContext).volatile().description('读取工作区规则文件（不读源码）'),
    minecraftOptimization: z.boolean().default(DEFAULT_SETTINGS.minecraftOptimization).volatile().description('启用 Minecraft 专项优化策略'),
    enableVisionContext: z.boolean().default(DEFAULT_SETTINGS.enableVisionContext).volatile().description('启用视觉上下文'),
    customInstructions: field(DEFAULT_SETTINGS.customInstructions, '附加到每次优化的自定义规则'),
  })
}

/**
 * Load the configuration schema, or return undefined when schemastery is absent.
 *
 * @returns the schema, or undefined.
 */
export async function loadConfigSchema() {
  try {
    const module = await import('@deepseek-ai/schemastery')
    return buildConfigSchema(module.default ?? module)
  } catch {
    return undefined
  }
}
