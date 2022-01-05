import ProgressBar from "components/ProgressBar/ProgressBar";
import { you } from "data/character";
import { skillMap } from "data/skills";
import { useCallback, useEffect, useRef } from "react";
import { costOnCharacter, doneCasting, setMainCharacter, updateCost } from "redux/character";
import { castSkillOnEnemy } from "redux/raid";
import { setupSkills } from "redux/skill";
import { setupSlots } from "redux/slots";
import { useAppDispatch, useAppSelector } from "redux/store";
import { Character, Skill } from "types/types";
import { getPercentage, numberToPercentage } from "util/utils";
import './Character.scss';

const CharacterPanel = (props: {
    className?: string
}) => {
    const { className } = props;

    const dispatch = useAppDispatch();
    const character: Character | undefined = useAppSelector(state => state.character.mainCharacter);

    const { staticResource, realtimeResource, realtimeAttributes, realtimeEnhancements, name, castingSkill, castingTime } = character || {} as Character;

    const time = useAppSelector(state => state.universal.time);

    // 初始化
    useEffect(() => {
        dispatch(setMainCharacter(you));
        dispatch(setupSkills(you.skills.map(s => skillMap[s])));
        dispatch(setupSlots(you.slots));
    }, [dispatch]);

    // 使用技能
    const doCost = useCallback((skill: Skill) => {
        dispatch(costOnCharacter(skill));
    }, [dispatch]);

    const doEffect = useCallback((skill: Skill) => {
        dispatch(castSkillOnEnemy({ skill, targetId: '1', time, caster: character }))
        dispatch(doneCasting())
    }, [character, dispatch, time]);

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
        if (realtimeResource && realtimeResource?.energy < staticResource.energy && time > lastTimeRegenerateEnergy.current + 100) {
            lastTimeRegenerateEnergy.current = time;
            dispatch(updateCost({
                type: 'energy',
                value: realtimeResource.energy + 1
            }))
        }
    }, [dispatch, realtimeResource, staticResource, time])

    // 念力回复
    const lastTimeRegenerateMana = useRef<number>(0);
    useEffect(() => {
        if (realtimeResource && realtimeResource?.mana < staticResource.mana && time > lastTimeRegenerateMana.current + 100) {
            lastTimeRegenerateMana.current = time;
            dispatch(updateCost({
                type: 'mana',
                value: realtimeResource.mana + (realtimeAttributes!.spirit) * 0.01
            }))
        }
    }, [dispatch, realtimeAttributes, realtimeResource, staticResource, time])

    const resources = [{
        label: '生命',
        value: realtimeResource?.health,
        cap: staticResource?.health ?? 100,
        color: 'orangered'
    }, {
        label: '念力',
        value: realtimeResource?.mana,
        cap: staticResource?.mana ?? 100,
        color: 'cyan'
    }, {
        label: '体力',
        value: realtimeResource?.energy,
        cap: staticResource?.energy ?? 100,
        color: 'lightgoldenrodyellow'
    }, {
        label: '惯性',
        value: realtimeResource?.fury,
        cap: staticResource?.fury ?? 100,
        color: 'lightgreen'
    }];

    const attributes = [{
        label: '力量',
        value: realtimeAttributes?.strength
    }, {
        label: '敏捷',
        value: realtimeAttributes?.agility
    }, {
        label: '智力',
        value: realtimeAttributes?.intelligence
    }, {
        label: '精神',
        value: realtimeAttributes?.spirit
    }]

    const enhancements = [{
        label: '暴击',
        value: realtimeEnhancements?.criticalChance
    }, {
        label: '爆伤',
        value: realtimeEnhancements?.criticalDamage
    }, {
        label: '急速',
        value: realtimeEnhancements?.haste
    }]

    const elements = [{
        label: '火',
        value: realtimeEnhancements?.elementMastery?.fire
    }, {
        label: '水',
        value: realtimeEnhancements?.elementMastery?.water
    }]

    return <div className={`character-wrapper ${className}`}>
        <div className="character-casting-wrapper">
            <div className="character-casting-name">{name}</div>
            <ProgressBar className="character-casting" percentage={castingPercentage} color="#eee">{castingTimeRemain.toFixed(1)}s</ProgressBar>
        </div>
        <div className="character-resources-wrapper">
            {resources.filter(r => r.cap > 0).map(resource => {
                const { label, value, cap, color } = resource;
                const percentage = getPercentage(value, cap);
                return <div className="character-resource" key={label}>
                    <div className="character-resource-label">{label}</div>
                    <ProgressBar className="character-resource-value" percentage={percentage} border={false} color={color}>{value}</ProgressBar>
                </div>
            })}
        </div>
        <div className="character-attributes-wrapper">
            {attributes.map(attribute => {
                const { label, value } = attribute;
                return <div className="character-attribute" key={label}>
                    <div className="character-attribute-label">{label}</div>
                    <div className="character-attribute-value">{value}</div>
                </div>
            })}
        </div>
        <div className="character-attributes-wrapper">
            {enhancements.map(enhance => {
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