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
   * 只有两种：**精力**是短循环资源（常规技能消耗、回复快），
   * **斗炁**是积攒型资源（高威力技能消耗、靠战斗动作积攒）。
   */
  resource: {
    hp: '生命',
    energy: '精力',
    douqi: '斗炁',
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
    maxEnergy: '精力上限',
    maxDouqi: '斗炁上限',
    hpRegen: '生命回复',
    energyRegen: '精力回复',
    douqiRegen: '斗炁回复',
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
    douqiFull: '满斗炁',
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
    cost: '精力或斗炁不足',
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
    phase: '阶段',
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
    phaseChange: '阶段转换',
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
   * 玩家技能。
   *
   * 命名对应资源模型：`strike` 积攒斗炁、`heavyStrike`/`rend` 消耗斗炁、
   * `finisher` 要求斗炁满；`dodge`/`guard` 消耗精力。
   */
  skill: {
    strike: { name: '贯击', desc: '基础攻击。积攒斗炁，并小幅回复精力。' },
    heavyStrike: { name: '崩拳', desc: '消耗 30 斗炁，造成一次高额物理伤害。' },
    riposte: { name: '无双击', desc: '派生技，只能在贯击后的瞬间接上。额外积攒斗炁。' },
    rend: { name: '裂伤', desc: '消耗 25 斗炁，造成流血并提高目标承受的物理伤害。' },
    finisher: {
      name: '斗炁爆发',
      desc: '需要斗炁全满。2.2 秒读条，打空全部斗炁换取巨额伤害，之后获得增伤。',
    },
    dodge: { name: '闪避', desc: '消耗精力，获得极短的完全无敌。不占公共冷却。' },
    guard: { name: '格挡', desc: '消耗精力，一段时间内大幅减伤。不占公共冷却。' },
  },

  /** Boss 技能与本体 */
  boss: {
    name: '堕落者·维罗特',
    crimsonArc: { name: '猩红弧光', desc: '前摇后用火焰横扫。必须闪避或格挡。' },
    tripleSlam: { name: '裂地三连', desc: '三段重击，每段都可闪避。' },
    corruption: { name: '腐蚀咏唱', desc: '可打断的高额法术。留一手打断技。' },
    empower: { name: '蓄能', desc: '8 秒内自身伤害提高 30%。' },
  },

  /** 界面文案 */
  screen: {
    pause: '暂停',
    resume: '继续',
    restart: '重新开始',
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
