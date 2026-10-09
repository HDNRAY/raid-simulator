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

  /** 资源名 */
  resource: {
    hp: '生命',
    mp: '魔力',
    energy: '体力',
    fury: '储能',
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
    maxMp: '魔力上限',
    maxEnergy: '体力上限',
    maxFury: '储能上限',
    hpRegen: '生命回复',
    mpRegen: '魔力回复',
    energyRegen: '体力回复',
    furyRegen: '储能回复',
  },

  /** HUD 文案 */
  hud: {
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

  /** 玩家技能 */
  skill: {
    slash: { name: '斩击', desc: '快速近战攻击，少量储能。可开启派生窗口。' },
    heavy: { name: '龙破斩', desc: '2 秒读条，高额法术伤害。读条期间可被打断。' },
    rend: { name: '割裂', desc: '造成流血，每层提高目标承受的物理伤害。' },
    arc: { name: '弧光斩', desc: '派生技。只能在斩击后的派生窗口内使用。' },
    dodge: { name: '闪避', desc: '300 毫秒无敌。不占公共冷却。' },
    guard: { name: '格挡', desc: '1.5 秒内减伤 60%。不占公共冷却。' },
    haste: { name: '风行术', desc: '15 秒内急速提高 20%。' },
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
