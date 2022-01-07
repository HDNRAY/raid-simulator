import ProgressBar from "components/ProgressBar/ProgressBar";
import { you } from "data/character";
import { skillMap } from "data/skills";
import { useCallback, useEffect, useMemo, useRef } from "react";
import { costOnCharacter, doneCasting, setMainCharacter, setTarget, updateCost } from "redux/character";
import { effectOnEnemy } from "redux/raid";
import { setupSlots } from "redux/slots";
import { useAppDispatch, useAppSelector } from "redux/store";
import { RealtimeCharacter, Skill } from "types/types";
import { computeCritical, getPercentage, numberToPercentage } from "util/utils";
import './Character.scss';

const CharacterPanel = (props: {
    className?: string
}) => {
    const { className } = props;

    const dispatch = useAppDispatch();
    const character: RealtimeCharacter | undefined = useAppSelector(state => state.character.mainCharacter);
    const selectedTarget = useAppSelector(state => state.character.target);
    const enemies = useAppSelector(state => state.raid.enemies);

    const { staticResources, resources, attributes, enhancements, name, castingSkillId, castingTime } = character || {} as RealtimeCharacter;
    const castingSkill: any = useMemo(() => castingSkillId && skillMap[castingSkillId], [castingSkillId])

    const time = useAppSelector(state => state.universal.time);

    useEffect(() => {
        dispatch(setTarget({
            id: enemies[0]?.id,
            type: 'enemy'
        }))
    }, [dispatch, enemies])

    // 初始化
    useEffect(() => {
        dispatch(setMainCharacter(you));
        dispatch(setupSlots(you.slots));
    }, [dispatch]);

    // 使用技能
    const doCost = useCallback((skill: Skill) => {
        skill.cost.forEach(c => {
            const value = typeof c.value === 'number' ? c.value : c.value({
                caster: character!,
                skill
            });
            dispatch(costOnCharacter({ type: c.type, value }))
        })
    }, [character, dispatch]);

    const doEffect = useCallback((skill: Skill) => {
        skill.effects.forEach(effect => {

            if (skill.target === 'self') {

            } else if (skill.target === 'enemy') {
                if (selectedTarget && !Array.isArray(selectedTarget) && selectedTarget.type === 'enemy') {
                    // 计算效果数字
                    const target = enemies.find(e => e.id === selectedTarget.id);
                    // 增加减少
                    const positiveTypes = ['heal', 'buff'];
                    const pon = positiveTypes.includes(effect.type) ? 1 : -1;
                    // 计算技能原始数值
                    const valueFromSkill = typeof effect.value === 'number' ? effect.value : effect.value({ skill, target, caster: character! });
                    // 检查暴击
                    const { criticalChance, criticalDamage } = character!.enhancements;
                    const [value, critical] = computeCritical(valueFromSkill, criticalChance, criticalDamage);

                    // 效果形式属性
                    const effected = effect.on || 'health';

                    dispatch(effectOnEnemy({ pon, effected, targetId: selectedTarget.id, value, critical, skillId: skill.id, time, caster: character! }))
                } else {

                }
            }
        })

        dispatch(doneCasting())
    }, [character, dispatch, enemies, selectedTarget, time]);

    // 读条时间
    const castingTimePast = castingTime ? time - castingTime : 0;
    // 读条百分比
    const castingPercentage = getPercentage(castingTimePast, castingSkill?.castTime);
    // 读条剩余时间
    const castingTimeRemain = castingSkill ? Math.max(castingSkill.castTime - castingTimePast, 0) / 1000 : 0

    // 使用技能
    useEffect(() => {
        if (castingSkill) {
            // 无需读条 或 读条完成
            if (castingSkill.castTime === 0 || castingTimePast >= castingSkill.castTime) {
                doCost(castingSkill);
                doEffect(castingSkill);
            }
        }
    }, [castingSkill, castingTimePast, dispatch, doCost, doEffect]);

    // 体力回复
    const lastTimeRegenerateEnergy = useRef<number>(0);
    useEffect(() => {
        if (resources && resources?.energy < staticResources.energy && time > lastTimeRegenerateEnergy.current + 100) {
            lastTimeRegenerateEnergy.current = time;
            dispatch(updateCost({
                type: 'energy',
                value: resources.energy + 1
            }))
        }
    }, [dispatch, resources, staticResources, time])

    // 念力回复
    const lastTimeRegenerateMana = useRef<number>(0);
    useEffect(() => {
        if (resources && resources?.mana < staticResources.mana && time > lastTimeRegenerateMana.current + 100) {
            lastTimeRegenerateMana.current = time;
            dispatch(updateCost({
                type: 'mana',
                value: resources.mana + (attributes!.spirit) * 0.01
            }))
        }
    }, [dispatch, attributes, resources, staticResources, time])

    const resourceLines = [{
        label: '生命',
        value: resources?.health,
        cap: staticResources?.health ?? 100,
        color: 'orangered'
    }, {
        label: '魔力',
        value: resources?.mana,
        cap: staticResources?.mana ?? 100,
        color: 'cyan'
    }, {
        label: '体力',
        value: resources?.energy,
        cap: staticResources?.energy ?? 100,
        color: 'lightgoldenrodyellow'
    }, {
        label: '惯性',
        value: resources?.fury,
        cap: staticResources?.fury ?? 100,
        color: 'lightgreen'
    }];

    const attributeLines = [{
        label: '力量',
        value: attributes?.strength
    }, {
        label: '敏捷',
        value: attributes?.agility
    }, {
        label: '智力',
        value: attributes?.intelligence
    }, {
        label: '精神',
        value: attributes?.spirit
    }]

    const enhancementLines = [{
        label: '暴击',
        value: enhancements?.criticalChance
    }, {
        label: '暴伤',
        value: enhancements?.criticalDamage
    }, {
        label: '急速',
        value: enhancements?.haste
    }]

    const elements = [{
        label: '火',
        value: enhancements?.mastery?.fire
    }, {
        label: '水',
        value: enhancements?.mastery?.water
    }]

    return <div className={`character-wrapper ${className}`}>
        <div className="character-casting-wrapper">
            <div className="character-casting-name">{name}</div>
            <ProgressBar className="character-casting" percentage={castingPercentage} color="#eee">{castingTimeRemain.toFixed(1)}s</ProgressBar>
        </div>
        <div className="character-resources-wrapper">
            {resourceLines.filter(r => r.cap > 0).map(resource => {
                const { label, value, cap, color } = resource;
                const percentage = getPercentage(value, cap);
                return <div className="character-resource" key={label}>
                    <div className="character-resource-label">{label}</div>
                    <ProgressBar className="character-resource-value" percentage={percentage} border={false} color={color}>{value}</ProgressBar>
                </div>
            })}
        </div>
        <div className="character-attributes-wrapper">
            {attributeLines.map(attribute => {
                const { label, value } = attribute;
                return <div className="character-attribute" key={label}>
                    <div className="character-attribute-label">{label}</div>
                    <div className="character-attribute-value">{value}</div>
                </div>
            })}
        </div>
        <div className="character-attributes-wrapper">
            {enhancementLines.map(enhance => {
                const { label, value } = enhance;
                return <div className="character-attribute" key={label}>
                    <div className="character-attribute-label">{label}</div>
                    <div className="character-attribute-value">{numberToPercentage(value)}</div>
                </div>
            })}
            <div className="character-elements-wrapper">
                {elements.map(element => {
                    const { label, value } = element;
                    return <div className="character-element" key={label}>
                        <div className="character-element-label">{label}</div>
                        <div className="character-element-value">{numberToPercentage(value)}</div>
                    </div>
                })}
            </div>
        </div>
    </div>
}

export default CharacterPanel