import ProgressBar from "components/ProgressBar/ProgressBar";
import { you } from "data/character";
import { skillMap } from "data/skills";
import { useEffect, useMemo, useRef } from "react";
import { recoverCost, setMainCharacter, setTarget } from "redux/character";
import { setupSlots } from "redux/slots";
import { useAppDispatch, useAppSelector } from "redux/store";
import { RealtimeCharacter } from "types/types";
import { getPercentage, numberToPercentage } from "util/utils";
import './Character.scss';

const CharacterPanel = (props: {
    className?: string
}) => {
    const { className } = props;

    const dispatch = useAppDispatch();
    const character: RealtimeCharacter | undefined = useAppSelector(state => state.character.mainCharacter);

    const enemies = useAppSelector(state => state.raid.enemies);

    const { staticResources, resources, attributes, enhancements, name, castingSkillId, castingTime } = character || {} as RealtimeCharacter;

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

    // 正在释放技能
    const castingSkill: any = useMemo(() => castingSkillId && skillMap[castingSkillId], [castingSkillId]);
    // 读条时间
    const castingTimePast = castingTime ? time - castingTime : 0;
    // 读条百分比
    const castingPercentage = getPercentage(castingTimePast, castingSkill?.castTime);
    // 读条剩余时间
    const castingTimeRemain = castingSkill ? Math.max(castingSkill.castTime - castingTimePast, 0) / 1000 : 0

    // 体力回复
    const lastTimeRegenerateEnergy = useRef<number>(0);
    useEffect(() => {
        if (resources && resources?.energy < staticResources.energy && time > lastTimeRegenerateEnergy.current + 100) {
            lastTimeRegenerateEnergy.current = time;
            dispatch(recoverCost({
                type: 'energy',
                value: 1
            }))
        }
    }, [dispatch, resources, staticResources, time])

    // 念力回复
    const lastTimeRegenerateMana = useRef<number>(0);
    useEffect(() => {
        if (resources && resources?.mana < staticResources.mana && time > lastTimeRegenerateMana.current + 100) {
            lastTimeRegenerateMana.current = time;
            dispatch(recoverCost({
                type: 'mana',
                value: attributes!.spirit * 0.1
            }))
        }
    }, [dispatch, attributes, resources, staticResources, time])

    const characterInfo = () => {
        if (!character) {
            return null
        }

        const resourceLines = [{
            label: '生命',
            value: resources.health,
            cap: staticResources.health ?? 100,
            color: 'orangered'
        }, {
            label: '魔力',
            value: resources.mana,
            cap: staticResources.mana ?? 100,
            color: 'cyan'
        }, {
            label: '体力',
            value: resources.energy,
            cap: staticResources.energy ?? 100,
            color: 'lightgoldenrodyellow'
        }, {
            label: '储能',
            value: resources.fury,
            cap: staticResources.fury ?? 100,
            color: 'lightgreen'
        }];

        const attributeLines = [{
            label: '力量',
            value: attributes.strength
        }, {
            label: '敏捷',
            value: attributes.agility
        }, {
            label: '智力',
            value: attributes.intelligence
        }, {
            label: '精神',
            value: attributes.spirit
        }]

        const enhancementLines = [{
            label: '暴击',
            value: enhancements.criticalChance
        }, {
            label: '暴伤',
            value: enhancements.criticalDamage
        }, {
            label: '急速',
            value: enhancements.haste
        }]

        const elements = [{
            label: '火',
            value: enhancements.mastery.fire
        }, {
            label: '水',
            value: enhancements.mastery.water
        }]

        return <>
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
        </>
    }

    return <div className={`character-wrapper ${className}`}>
        <div className="character-casting-wrapper">
            <div className="character-casting-name">{name}</div>
            <ProgressBar className="character-casting" percentage={castingPercentage} color="#eee">{castingTimeRemain.toFixed(1)}s</ProgressBar>
        </div>
        {characterInfo()}
    </div>
}

export default CharacterPanel