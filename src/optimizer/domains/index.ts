/**
 * Domain strategies: the registry the detector scores against.
 *
 * Design rule — a domain is a *thinking checklist*, never a requirement list.
 * `considerations` names the questions a specialist in that field would ask
 * before starting; the system prompt instructs the model to drop any question
 * the user's actual intent does not support. That is what keeps "enhance the
 * intent" from sliding into "invent a different task".
 *
 * Adding a domain is one object in {@link DOMAINS}. Nothing else changes: the
 * detector scores it automatically and the prompt builder renders its
 * considerations into the system prompt.
 *
 * @module dsh-prompt-optimizer/optimizer/domains
 */

import type { DomainStrategy } from '../../shared/types.ts'

/**
 * Every registered domain, in registry order.
 *
 * Order is a tiebreak only; scoring decides the winner. `general` must stay
 * last and is the unconditional fallback.
 */
export const DOMAINS: readonly DomainStrategy[] = [
  {
    id: 'minecraft',
    label: 'Minecraft',
    when: 'Minecraft mods, resource packs, datapacks, entities, textures, GUIs or world generation.',
    signals: [
      'minecraft', 'minecraft mod', 'neoforge', 'forge', 'fabric', 'mod loader',
      'resource pack', 'resourcepack', 'datapack', 'data pack', 'blockbench',
      '纹理', '材质包', '模组', '整合包', '我的世界', '方块', '生物模型', '凋灵',
      'srp', 'scape and run', 'parasites', '末影人', '僵尸', '爬行者', '苦力怕',
      '原版风格', 'vanilla style', 'mc ', 'mc模组',
    ],
    considerations: [
      'Target Minecraft version and loader (NeoForge / Forge / Fabric / vanilla datapack) — ask only if the project does not already pin it.',
      'Whether the deliverable is Java code, JSON data, a texture, a model, or a mix.',
      'Vanilla visual language: pixel grid, palette discipline, silhouette readability at game distance.',
      'In-game constraints: texture resolution (16x16 unless stated), model cube limits, GUI scaling, render distance.',
      'Whether the change must survive existing saves and stay compatible with other mods.',
    ],
    sections: ['Technical Details', 'Design Direction'],
    avoid: [
      'Web UI / SaaS conventions (cards, glassmorphism, drop shadows, gradients) unless the task is literally a web page.',
      'Photorealistic 3D, cinematic concept art, or generic anime styling for Minecraft assets.',
      'Inventing a specific loader or MC version the project has not declared.',
    ],
  },
  {
    id: 'ui-design',
    label: 'UI / UX / Product Design',
    when: 'Screens, pages, dashboards, design systems, interaction flows, visual identity, brand visuals.',
    signals: [
      'ui', 'ux', '界面', '设计', '页面', '首页', '后台', '管理后台', 'dashboard',
      'landing page', 'landing', 'wireframe', '原型', 'prototype', 'design system',
      '设计系统', '视觉', '交互', '布局', 'layout', 'figma', '组件库', 'component library',
      'brand', '品牌', 'logo', '图标', 'icon', '响应式', 'responsive', '信息架构',
      'design', 'style guide', 'color scheme', '配色', '排版', 'typography',
    ],
    considerations: [
      'Who the user is and what single job the screen must complete.',
      'Information hierarchy: what is primary, what is secondary, what can be hidden.',
      'The primary call to action, and every competing action that dilutes it.',
      'Layout structure and grid, spacing rhythm, density appropriate to the data volume.',
      'Interaction logic: states (empty, loading, error, partial), transitions, feedback.',
      'Responsive behaviour and platform constraints (viewport, touch vs pointer).',
      'Accessibility: contrast, focus order, target size, text scaling.',
    ],
    sections: ['Design Direction', 'Requirements'],
    avoid: [
      'Treating "premium/high-end" as glassmorphism + gradients + rounded corners + heavy glow.',
      'Stacking decorative adjectives with no design decision behind them.',
      'Adding features the user never asked for to make the design look richer.',
    ],
  },
  {
    id: 'image-generation',
    label: 'Image / Visual Generation',
    when: 'Prompts for image models, illustrations, concept art, icons, textures, sprite sheets.',
    signals: [
      '画', '绘制', '图片', '图像', '插画', '原画', '概念图', 'concept art', 'illustration',
      'midjourney', 'stable diffusion', 'sdxl', 'dall-e', '文生图', '生图', '生成图片',
      'image prompt', 'sprite', '贴图', '海报', 'poster', 'banner', '封面', 'thumbnail',
      'pixel art', '像素画', '立绘', 'character design', '角色设计',
    ],
    considerations: [
      'Subject and the single visual focus; everything else is support.',
      'Composition: framing, camera angle, subject placement, negative space.',
      'Style anchor that is actually meaningful (medium, era, technique) rather than vague praise.',
      'Palette and value structure: dominant, accent, contrast target.',
      'Lighting direction and material read (matte, glossy, translucent).',
      'Aspect ratio, resolution, and platform constraints.',
      'What must NOT appear.',
    ],
    sections: ['Design Direction', 'Avoid'],
    avoid: [
      'Keyword soup with no compositional or stylistic decision in it.',
      'Words like "masterpiece, best quality, 8k" used as substitutes for real direction.',
      'Describing an attached reference image the optimizer has not actually seen.',
    ],
  },
  {
    id: 'game-development',
    label: 'Game Development',
    when: 'Gameplay systems, mechanics, balancing, game feel, engine work outside Minecraft.',
    signals: [
      '游戏', 'game', 'gameplay', '玩法', '关卡', 'level design', 'unity', 'unreal',
      'godot', 'roguelike', 'rpg', 'fps', '战斗系统', 'combat', '技能', 'skill',
      '数值', 'balancing', '平衡', 'boss', '敌人ai', 'enemy ai', '掉落', 'loot',
      '存档', 'save system', '多人', 'multiplayer', 'game feel', '手感',
    ],
    considerations: [
      'The core loop this feature serves, and how the player experiences it.',
      'Input → feedback → reward: what the player does, sees, and gets.',
      'Numeric targets and how they interact with existing systems.',
      'Edge cases: simultaneous triggers, save/load mid-state, network authority.',
      'Engine and version constraints, and performance budget.',
    ],
    sections: ['Technical Details', 'Requirements', 'Acceptance Criteria'],
    avoid: ['Designing a generic "fun" feature without naming the loop it belongs to.'],
  },
  {
    id: 'coding',
    label: 'Software / Coding',
    when: 'Writing, changing, refactoring or reviewing code; building features; fixing bugs.',
    signals: [
      '代码', 'code', '编程', '函数', 'function', '重构', 'refactor', '实现', 'implement',
      '开发', 'develop', 'bug', '修复', '报错', 'error', '异常', 'exception', '崩溃', 'crash',
      'api', '接口', '库', 'library', '模块', 'module', '脚本', 'script', '自动化', 'automation',
      'java', 'python', 'typescript', 'javascript', 'rust', 'go', 'c++', 'react', 'vue',
      '数据库', 'database', 'sql', 'postgres', 'mysql', 'sqlite', 'redis', '缓存', 'cache',
      '架构', 'architecture', '性能', 'performance', '优化性能', '测试', 'test', '单元测试',
      '编译器', 'compile', '构建', 'build', '部署', 'deploy', 'docker', 'kubernetes', 'ci/cd',
      'git', '仓库', 'repo', 'cli', 'sdk', 'orm', '微服务', 'microservice', 'rest', 'graphql',
    ],
    considerations: [
      'What the finished change must do, stated as observable behaviour.',
      'The existing stack and conventions — read the project before choosing a library or a pattern.',
      'The exact files or modules the change touches, and what must keep working.',
      'Error handling, edge cases, and boundary conditions.',
      'How the change will be verified: test, command, or manual step.',
      'What is explicitly out of scope.',
    ],
    sections: ['Technical Details', 'Acceptance Criteria'],
    avoid: [
      'Picking a specific framework, database, or library the project has not already chosen.',
      'Specifying an implementation the user did not ask for when a simpler one satisfies the goal.',
    ],
  },
  {
    id: 'writing',
    label: 'Writing / Content',
    when: 'Articles, documentation, marketing copy, stories, editing, summaries, translation.',
    signals: [
      '写', '写作', '文章', '文案', '稿子', 'copywriting', 'blog', '博客', '文档', 'documentation',
      'readme', 'story', '小说', '剧本', 'script writing', '新闻', 'newsletter', '邮件', 'email',
      '润色', 'polish', '改写', 'rewrite', '摘要', 'summary', '总结', 'summarize', '大纲', 'outline',
      '翻译', 'translate', 'translation', '校对', 'proofread', '演讲稿', 'speech', 'social media',
      '小红书', '公众号', '推文', 'twitter', 'linkedin', 'seo',
    ],
    considerations: [
      'Audience: who reads this, and what do they already know.',
      'Purpose: inform, persuade, entertain, instruct — one primary purpose.',
      'Voice and register, anchored to something concrete rather than "professional".',
      'Structure: what the reader needs first, and the order that earns attention.',
      'Length, format, and the platform that will render it.',
      'Facts the writer must not invent, and claims that need a source.',
    ],
    sections: ['Requirements', 'Output'],
    avoid: [
      'Inflating word count with filler that carries no information.',
      'Turning a translation request into a rewrite, or a summary into an expansion.',
    ],
  },
  {
    id: 'research',
    label: 'Research / Analysis',
    when: 'Investigating a topic, comparing options, analysing a company or market, literature review.',
    signals: [
      '调研', '研究', 'research', '分析', 'analysis', 'analyze', 'analyse', '调查', 'survey',
      '对比', 'compare', 'comparison', '选型', 'evaluation', '评估', '文献', 'literature',
      '论文', 'paper', 'market', '市场', '竞品', 'competitor', '行业', 'industry', '报告', 'report',
      '公司', 'company', '商业', 'business', '策略', 'strategy', '趋势', 'trend',
    ],
    considerations: [
      'The decision this research must support — analysis without a decision is trivia.',
      'Dimensions to compare on, and the weight each carries.',
      'Source quality and recency expectations; which claims need citation.',
      'Time range and geography of the evidence.',
      'Output structure: comparison table, ranked recommendation, or narrative.',
      'How uncertainty and missing data are marked rather than smoothed over.',
    ],
    sections: ['Objective', 'Output', 'Acceptance Criteria'],
    avoid: [
      'Presenting invented figures, dates, or citations as fact.',
      'Stating a conclusion the evidence in the request does not support.',
    ],
  },
  {
    id: 'data-analysis',
    label: 'Data / Analytics',
    when: 'Datasets, metrics, dashboards, statistics, spreadsheets, reporting pipelines.',
    signals: [
      '数据', 'data', 'dataset', '指标', 'metric', 'kpi', '统计', 'statistics', 'excel',
      '表格', 'spreadsheet', 'csv', 'pandas', 'numpy', '可视化', 'visualization', 'chart',
      '图表', '报表', 'report', 'bi', 'etl', 'pipeline', '数据清洗', 'cleaning', '回归',
      'regression', '聚类', 'clustering', '预测', 'forecast', 'a/b', 'ab test', '漏斗', 'funnel',
    ],
    considerations: [
      'The question the analysis answers, and the decision it feeds.',
      'Input shape: source, schema, granularity, known quality problems.',
      'Definition of every metric — an undefined metric is a future argument.',
      'Handling of missing values, outliers, and duplicates.',
      'Output form: table, chart, narrative, or notebook, and who consumes it.',
      'How results will be sanity-checked.',
    ],
    sections: ['Objective', 'Output', 'Acceptance Criteria'],
    avoid: ['Correlation asserted as causation.', 'Producing a chart without naming the question it answers.'],
  },
  {
    id: 'education',
    label: 'Education / Learning',
    when: 'Explaining concepts, tutoring, study plans, exercises, curricula.',
    signals: [
      '学习', 'learn', '教学', 'teach', '讲解', 'explain', '解释', '教程', 'tutorial', '课程',
      'course', 'curriculum', '习题', 'exercise', '练习', '作业', 'homework', '考试', 'exam',
      '入门', 'beginner', '从零开始', 'from scratch', '原理', 'principle', '入门到精通', '知识点',
    ],
    considerations: [
      'Learner current level and the specific gap to close.',
      'The concrete outcome: what they can do afterwards that they cannot now.',
      'Ordering that builds on what they already know.',
      'Worked examples and practice that make the concept testable.',
      'Depth ceiling — where to stop so the explanation stays useful.',
    ],
    sections: ['Objective', 'Output'],
    avoid: ['Dumping encyclopedic coverage instead of teaching the named gap.'],
  },
  {
    id: 'business',
    label: 'Business / Product',
    when: 'Product decisions, project plans, business strategy, operations, marketing plans.',
    signals: [
      '产品', 'product', '需求', 'requirement', 'prd', '规划', 'roadmap', '路线图', '项目',
      'project', '管理', 'management', '运营', 'operations', '流程', 'process', '方案', 'proposal',
      '商业计划', 'pricing', '定价', '增长', 'growth', '营销', 'marketing', '推广', 'promotion',
      '用户画像', 'persona', 'mvp', '里程碑', 'milestone', '排期', 'schedule',
    ],
    considerations: [
      'The business or user outcome the work must move.',
      'Success metric and how it is measured.',
      'Constraints: budget, timeline, headcount, existing commitments.',
      'Stakeholders and who must approve.',
      'Risks and the cheapest way to learn whether the plan works.',
    ],
    sections: ['Objective', 'Requirements', 'Acceptance Criteria'],
    avoid: ['Producing a plan with no measurable outcome and no constraint.'],
  },
  {
    id: 'general',
    label: 'General',
    when: 'Everyday requests, questions, and anything the registry does not specifically claim.',
    signals: [],
    considerations: [
      'What the user actually wants to end up with.',
      'Any missing detail that would change the answer.',
      'The output form that is easiest for the user to consume.',
    ],
    sections: [],
    avoid: [],
  },
]

/** Look up a strategy by id, falling back to `general`. */
export function domainById(id: string): DomainStrategy {
  return DOMAINS.find((domain) => domain.id === id) ?? DOMAINS[DOMAINS.length - 1]
}
