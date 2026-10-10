/**
 * 中文语言包（基准语言）。
 *
 * **这是整个 src/ 下唯一允许出现中文的地方**（i18n 规范 I2）。
 * 其他任何地方写死中文都会被 lint 拦下（I1）。
 *
 * 命名规则（i18n 规范 §5）：`<domain>.<subject>[.<field>]`
 *   - 全小写驼峰，不含空格
 *   - 内容 key 的 subject 必须与 GameEntity.id 有确定性映射
 *     （`id: 'entropy-clock'` → `entity.entropyClock.name`），由校验器强制
 */
export const zhCN = {
  common: {
    confirm: '确认',
    cancel: '取消',
    back: '返回',
    close: '关闭',
    yes: '是',
    no: '否',
  },

  /**
   * 资源名。
   *
   * 三个单字：**血 / 炁 / 缠**。
   *
   *   `energy` → **炁**  短循环资源，每 0.1 秒自动回复 1 点
   *   `douqi`  → **缠**  积攒型资源，按伤害换算（造成或受到都算）
   *   `hp`     → **血**  生死线
   *
   * ⚠️ 注意标识符与中文名的对应关系：`energy` 是"炁"、`douqi` 是"缠"。
   * 代码里的 `douqi` **不是**"斗炁"的缩写 —— 那个名字在 2026-10-09
   * 与"精力"对调过一次，标识符出于历史原因保留了。
   * 改中文名只需要动这个文件，不影响引擎。
   */
  resource: {
    hp: '血',
    energy: '炁',
    douqi: '缠',
    /**
     * 状态条上的**单字标签**（楷体显示）。
     *
     * 目前与全名相同 —— 这三个字本身就是单字。
     * 之所以仍然单独一组：条宽只有 200px，将来若全名变长
     * （例如"生命值"），标签需要独立于全名，不必再改布局。
     */
    hpShort: '血',
    energyShort: '炁',
    douqiShort: '缠',
  },

  /** 主属性与次级属性 */
  stat: {
    strength: '力量',
    agility: '敏捷',
    intelligence: '智力',
    spirit: '精神',
    critChance: '暴击',
    critDamage: '暴伤',
    haste: '急速',
    armor: '护甲',
    tenacity: '韧性',
    castSpeed: '施放速度',
    cooldownRate: '冷却速率',
    damageBoost: '伤害加成',
    damageMult: '最终伤害',
    physicalBoost: '物理加成',
    spellBoost: '法术加成',
    dotBoost: '持续伤害加成',
    directBoost: '直接伤害加成',
    critDamageBoost: '暴击伤害加成',
    armorPen: '护甲穿透',
    vulnerability: '易伤',
    damageTakenMult: '受到伤害',
    healingBoost: '治疗加成',
    shieldBoost: '护盾加成',
    maxHp: '生命上限',
    maxEnergy: '炁上限',
    maxDouqi: '缠上限',
    hpRegen: '生命回复',
    energyRegen: '炁回复',
    douqiRegen: '缠回复',
  },

  /**
   * buff / debuff 图标上的**极简标签**（最多 2 字）。
   *
   * 单独一组而不是复用 `nameKey`：完整名称在横排图标条上会把版面撑爆。
   * 也不用"截取全名前两字" —— "势能涌动"截成"势能"读不出含义。
   */
  buffShort: {
    dodgeIframe: '无敌',
    guard: '减伤',
    guardPerfect: '完美',
    comboWindow: '派生',
    haste: '急速',
    bleed: '流血',
    enrage: '狂暴',
    empowered: '强化',
    telegraph: '前摇',
    douqiFull: '炁满',
    sunder: '裂',
    bossArmor: '霸体',
  },

  /** 预警提示：告诉玩家"现在该做什么" */
  hint: {
    dodgeOrGuard: '闪避或格挡',
    /**
     * 需求：不再显示"可打断" —— 所有 Boss 招式默认都能打断，
     * 只有霸体状态挡得住，而那种情况会显示 `armored`。
     */
    armored: '霸体',
    dodge: '闪避',
    guard: '格挡',
  },

  /**
   * 技能不可用的原因。
   *
   * 这些文案由**状态提示区**统一显示（技能格 48px 放不下），
   * 格式是「技能名 · 原因」。
   */
  /**
   * ⚠️ 用词统一到「**施放**」，不用「施法」。
   *
   * 需求："我点击攻，显示『攻 · 正在施法中』……这个招式应该用 施放中"
   *
   * 早先这里是"施法中"，而 `reject.casting` 又是"正在施法" ——
   * 同一个概念两种说法。技能是"招式"，玩家做的是"施放"。
   */
  block: {
    comboWindow: '派生窗口未开启',
    cost: '炁或缠不足',
    cooldown: '冷却中',
    casting: '正在施放中',
    /**
     * 「倒地」：被限制只能用闪避类技能。
     *
     * ⚠️ 说的是"**只能闪避**"而不是"被限制" —— 玩家需要立刻知道
     * **出路是什么**（按「闪」或「避」），而不是知道自己动不了。
     */
    tagRestricted: '倒地 · 只能闪避',
    locked: '被限制',
    condition: '条件不满足',
    target: '没有目标',
  },

  /** HUD 文案 */
  hud: {
    you: '你',
    iframe: 'I-FRAME',
    combo: '派生',
    level: '等级',
    casting: '施放中',
    interrupted: '被打断',
    dodged: '闪躲',
    immune: '免疫',
  },

  /** 技能施放被拒绝的原因（对应 EventDef 的 reject reason） */
  reject: {
    cooldown: '技能冷却中',
    cost: '资源不足',
    casting: '正在施放',
    condition: '条件不满足',
    locked: '当前无法行动',
    target: '目标无效',
  },

  /** 战斗事件提示 */
  event: {
    crit: '暴击',
    miss: '未命中',
    immune: '免疫',
    interruptSuccess: '打断成功',
    enrage: '狂暴',
    phaseChange: '形态变化',
    victory: '胜利',
    defeat: '失败',
    timeout: '时间耗尽',
  },

  /** 内容：装备 / 奇物 */
  entity: {
    entropyClock: {
      name: '熵之钟',
      desc: '根据智力提升伤害；暴击后使该效果翻倍，持续 10 秒。',
      sources: {
        potential: '熵之钟·势能',
        surge: '熵之钟·涌动',
      },
    },
  },

  /** 内容：buff */
  buff: {
    entropySurge: { name: '势能涌动' },
  },

  /**
   * 玩家技能。**每个技能一个字** —— 图标就直接用这个字（楷体）。
   *
   * 命名与数值刻度见 `src/data/content.ts` 顶部说明。
   */
  skill: {
    attack: {
      name: '攻',
      desc: '普攻。消耗 10 炁，造成 10 点伤害。'
    },
    /**
     * 「避」= 原「闪」。
     *
     * ⚠️ **技能 id 仍是 `dodge`** —— 只改显示名。改 id 会连带打断
     * buff 的 `dodge-*` 前缀判断（人物位移与变色都靠它）、默认键位、
     * 以及既有绑定。
     */
    dodge: {
      name: '避',
      desc: '消耗 30 炁，获得 0.5 秒完全无敌。瞬发，随时可按。'
    },
    /**
     * 「闪」= 新增的**免费**短无敌。
     *
     * 与「避」的分工：避 30 炁 / 0.5 秒；闪 0 消耗 / 0.1 秒。
     * 炁见底时仍有手段躲，代价是窗口窄得多。
     */
    flash: {
      name: '闪',
      desc: '不消耗任何资源，获得 0.1 秒无敌。瞬发，炁不足时的兜底。'
    },
    guard: {
      name: '防',
      desc: '按住持续减伤 40%，每 0.1 秒消耗 2 炁。松开即取消。'
    },
    break: {
      name: '破',
      desc: '瞬发。打断目标的任何招式。固定 5 秒冷却。',
    },
    blast: {
      name: '轰',
      desc: '消耗 50 缠，造成 30 点伤害并使目标易伤。'
    },
    focus: {
      name: '凝',
      desc: '消耗 50 缠，自身增伤 20%，持续 30 秒。'
    },
  },

  /**
   * debuff 名称。
   *
   * `knockdown` = 「倒地」：Boss 的「横扫」命中后玩家 2 秒内只能按
   * 带「闪避」tag 的技能（「闪」/「避」）。
   */
  debuff: {
    sunder: { name: '裂' },
    knockdown: { name: '倒地' },
  },

  /** Boss 技能与本体 */
  boss: {
    name: '伪名一郎',
    cleave: { name: '重斩', desc: '1.8 秒前摇，造成 28 点物理伤害，冷却 6 秒。可打断、可闪避、可格挡。' },
    sweep: { name: '横扫', desc: '2.2 秒前摇，造成 36 点火焰伤害，冷却 10 秒。可打断、可闪避、可格挡。' },
    empower: { name: '蓄能', desc: '前摇后自身增伤，持续 16 秒。打断它可以免掉一轮爆发。' },
    /**
     * 霸体：Boss 的"不能被干扰"窗口。
     *
     * 描述里点明**连「破」也打不断** —— 否则玩家会一直尝试用「破」
     * 去打断它，然后以为是 bug。
     */
    armor: {
      name: '霸体',
      desc: '给自己挂上霸体，数秒内**无法被打断**（连「破」也无效）。冷却较长。',
    },
  },

  /** 界面文案 */
  /**
   * 设置界面。
   *
   * 分 tab 组织；`tabGeneral` 目前是空的（占位），
   * 后续放音量、画面缩放、伤害数字开关之类。
   */
  settings: {
    title: '设置',
    /**
     * 按钮上的字。
     *
     * **单字**而不是「设置」—— 按钮只有 26px 宽，两个字会溢出；
     * 而且本作整套 UI 的语言就是"一格一字"（技能也是攻/轰/凝/破/闪/防）。
     * 完整名字留给弹窗标题。
     */
    open: '设',
    /**
     * 快捷键**提示**：只放那个键本身。
     *
     * 它会被画在图标旁边（`IconButton` 的 `shortcut`），所以
     * 只能是"一个键"，不能是一句话 —— 一句话会挤掉图标。
     * 完整的说明放在 `openKeyHint`。
     *
     * 为什么选 `,`：Esc 已经有"暂停 / 返回"的语义；`,` 紧挨技能键区、
     * 单键、不与任何技能位冲突。
     */
    openKey: 'Esc',
    /** 完整说明（用在帮助文本里，不画在按钮旁） */
    openKeyHint: '按 Esc 或 , 打开设置；也可以 ↑ 选中后 Enter',
    close: '关闭',
    tabGeneral: '通用 (G)',
    tabKeys: '按键 (K)',
    /** 通用 tab 暂时没有可调项 */
    /** 通用页：UI 缩放 slider */
    uiScale: 'UI 缩放',
    /**
     * 触屏按钮的**只读预览**（需求："暂时就不给玩家自由编辑了"）。
     *
     * 既然不给编辑，这里只告诉玩家"现在是什么样" ——
     * 按钮由键位表推导，所以它同时也解释了"为什么这些技能在场上"。
     */
    touchButtons: '触屏按钮',
    generalHint: '← → 调整，↑ ↓ 切换项',
    generalEmpty: '暂时还没有可调项',
    generalEmptyHint: '音量、画面与体验相关的选项之后加在这里',

    /** 按键设置 */
    /**
     * 招式提示标签的文案。
     *
     * 需求把它们的效果说得很清楚：
     *   - 「霸体」→ 提示玩家**无法被打断**（别浪费「破」）
     *   - 「高伤」→ 提示**闪避比防御更值得**（闪避全免，防御只减伤）
     *   - 「打断」→ 这一招会打断目标读条
     */
    /**
     * 战斗日志的文案。
     *
     * 需求："在屏幕右侧，加一个 log 面板，闪避，造成伤害什么的也记录一下"。
     *
     * 这些 key 由 `app/logFormat.ts` 产生（**格式化层只给 key + 参数**），
     * 文案在这里 —— 换语言时只需重新取词，历史条目不用重算。
     */
    hintTags: {
      interruptImmune: '霸体',
      highDamage: '高伤',
      interrupt: '打断',
    },
    /**
     * 助记键提示直接写进文案（"通用 (G)"）而不是另起一个 Label。
     *
     * 理由：这三处的键是**固定的助记字母**（一个字符），而技能格上
     * 的键是**可改的**（所以那里必须单独渲染、还要能显示"未绑定"）。
     * 固定值走文案更省事，也不会与技能格的渲染逻辑混淆。
     */
    /** 详情区：代价（`{value}` + 资源名）与冷却（秒） */
    detailCost: '{value} {resource}',
    detailCostPerSecond: '{value} {resource}/秒',
    detailCd: '冷却 {seconds} 秒',
    keysHint: '方向键选择，Enter 改键，Esc 返回',
    /**
     * 触屏版的按键页提示。
     *
     * 触屏玩家改不了键（没有键），所以这里只说"点技能看详情"——
     * 页面还在是因为"技能全集"由它承载（见 `KeyGridState.showKeyHints`）。
     */
    keysHintTap: '点技能查看详情',
    keysCapturingHint: '按下想用的键（Esc 取消）',
    keysCapturing: '请按键…',
    keysConflict: '该键已被占用',
    /**
     * 系统保留键的提示。
     *
     * `{key}` 是被拒的那个键名（由 `reservedKeyLabel` 给出可读形式）。
     * 明确写出"哪些不能绑"，玩家才不会一直试。
     */
    keysReserved: '{key} 是系统保留键，不能绑定',
    keysReservedHint: 'Esc / Tab / Enter / F1–F12 / 单独的 Shift、Ctrl、Alt 不能绑定',
    keysReset: '恢复默认 (R)',
    keysResetDone: '已恢复默认键位',
    /** 键位表的两列标题 */
    keyColumnAction: '技能',
    keyColumnKey: '按键',
    /** 键名显示：没绑定的键 */
    keyUnbound: '未绑定',
  },

  /**
   * 战斗日志（`app/logFormat.ts` 产生 key，这里给文案）。
   *
   * 参数用 `{name}` 形式插值（见 translator 的模板规则）。
   */
  log: {
    title: '战斗日志',
    damage: '造成 {amount} 伤害',
    takeDamage: '受到 {amount} 伤害',
    avoided: '闪躲',
    missed: '未命中',
    castInterrupted: '读条被打断（{reason}）',
    interruptSuccess: '打断成功',
    interruptImmune: '目标霸体，打断无效',
    skillRejected: '技能被拒（{reason}）',
    heal: '回复 {amount}',
    encounterEnd: '战斗结束',
  },
  screen: {
    pause: '暂停',
    resume: '继续',
    restart: '重新开始',
    victory: '战斗胜利',
    defeat: '战斗失败',
    /** 失败原因（对应 EndReason） */
    defeatedByTimeout: '时间耗尽',
    defeatedByDeath: '你倒下了',
    defeatedByEnrage: '被狂暴的 Boss 击溃',
    wonByKill: '击败了{name}',
    /** 结算面板上的统计标签 */
    statTime: '用时',
    statRemainingHp: '剩余生命',
    statTotalDamage: '造成伤害',
    statDps: '每秒伤害',
    hintRestart: '按 Enter 再来一次',
    /**
     * 触屏版的重开提示。
     *
     * 需求："包括 'enter' 再来一次也改成点击屏幕再来一次之类的。"
     *
     * ⚠️ 触屏没有 Enter，所以说"按 Enter"是错的；而且触屏上**点屏幕
     * 任意处**都能重开（见 `main.ts` 的 pointerdown 路由），所以文案
     * 要写"点击屏幕"而不是"点这个按钮"。
     */
    hintRestartTap: '点击屏幕再来一次',
    settings: '设置',
    quit: '退出',
    rebind: '按键设置',
    result: '战斗结算',
    scaleMode: '缩放模式',
    scaleFit: '填满屏幕',
    scaleInteger: '整数倍（更锐利）',
    language: '语言',
  },
} as const;
