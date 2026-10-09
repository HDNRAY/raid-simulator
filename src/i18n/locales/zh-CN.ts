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
    castSpeed: '施法速度',
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
    gcd: '冷却',
    douqiFull: '炁满',
    sunder: '裂',
  },

  /** 预警提示：告诉玩家"现在该做什么" */
  hint: {
    dodgeOrGuard: '闪避或格挡',
    interruptible: '可打断',
    dodge: '闪避',
    guard: '格挡',
  },

  /**
   * 技能不可用的原因。
   *
   * 这些文案由**状态提示区**统一显示（技能格 48px 放不下），
   * 格式是「技能名 · 原因」。
   */
  block: {
    comboWindow: '派生窗口未开启',
    cost: '炁或缠不足',
    gcd: '公共冷却中',
    cooldown: '冷却中',
    casting: '正在施法中',
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
    casting: '施法中',
    interrupted: '被打断',
    dodged: '闪避',
    immune: '免疫',
  },

  /** 技能施放被拒绝的原因（对应 EventDef 的 reject reason） */
  reject: {
    gcd: '公共冷却中',
    cooldown: '技能冷却中',
    cost: '资源不足',
    casting: '正在施法',
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
    dodge: {
      name: '闪',
      desc: '消耗 40 炁，获得 0.5 秒完全无敌。不占公共冷却。'
    },
    guard: {
      name: '防',
      desc: '按住持续减伤 40%，每 0.1 秒消耗 2 炁。松开即取消。'
    },
    break: {
      name: '破',
      desc: '打断目标的任何招式。固定 5 秒冷却，不占公共冷却。',
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

  /** 玩家施加的 debuff */
  debuff: {
    sunder: { name: '裂' },
  },

  /** Boss 技能与本体 */
  boss: {
    name: '堕落者·维罗特',
    cleave: { name: '重斩', desc: '0.8 秒前摇，造成 18 点物理伤害。可打断、可闪避、可格挡。' },
    sweep: { name: '横扫', desc: '1.2 秒前摇，造成 30 点火焰伤害。可打断、可闪避、可格挡。' },
    empower: { name: '蓄能', desc: '1 秒前摇，之后 10 秒内自身增伤 30%。打断它可以免掉一轮爆发。' },
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
    close: '关闭',
    tabGeneral: '通用',
    tabKeys: '按键',
    /** 通用 tab 暂时没有可调项 */
    generalEmpty: '暂时还没有可调项',
    generalEmptyHint: '音量、画面与体验相关的选项之后加在这里',

    /** 按键设置 */
    keysHint: '点击某一项，然后按下你想用的键',
    keysCapturing: '请按键…',
    keysConflict: '该键已被占用',
    keysReset: '恢复默认',
    keysResetDone: '已恢复默认键位',
    /** 键位表的两列标题 */
    keyColumnAction: '技能',
    keyColumnKey: '按键',
    /** 键名显示：没绑定的键 */
    keyUnbound: '未绑定',
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
    wonByKill: '击败了堕落者·维罗特',
    /** 结算面板上的统计标签 */
    statTime: '用时',
    statRemainingHp: '剩余生命',
    statTotalDamage: '造成伤害',
    statDps: '每秒伤害',
    hintRestart: '按 Enter 再来一次',
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
