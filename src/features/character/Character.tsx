import ProgressBar from "components/basic/progress-bar/ProgressBar";
import { you } from "data/character";
import CastingBar from "features/casting-bar/CastingBar";
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

    const { availableResources, resources, attributes, enhancements, name } = character || {} as RealtimeCharacter;

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

    // 体力回复 每0.1秒1点体力
    const lastTimeRegenerateEnergy = useRef<number>(0);
    useEffect(() => {
        const regenerateSpeed = 100 * (1 - (enhancements?.haste || 0))
        if (resources && resources?.energy < availableResources.energy && time > lastTimeRegenerateEnergy.current + regenerateSpeed) {
            lastTimeRegenerateEnergy.current = time;
            dispatch(recoverCost({
                type: 'energy',
                value: 1
            }))
        }
    }, [dispatch, resources, availableResources, time, enhancements])

    // 念力回复 每0.1秒 0.1 * 精神
    const lastTimeRegenerateMana = useRef<number>(0);
    useEffect(() => {
        if (resources && resources?.mana < availableResources.mana && time > lastTimeRegenerateMana.current + 100) {
            lastTimeRegenerateMana.current = time;
            dispatch(recoverCost({
                type: 'mana',
                value: attributes!.spirit * 0.1
            }))
        }
    }, [dispatch, attributes, resources, availableResources, time])

    // 纯显示
    const characterResources = useMemo(() => {
        const resourceLines = [{
            label: '生命',
            value: resources?.health,
            cap: availableResources?.health ?? 100,
            color: 'orangered'
        }, {
            label: '魔力',
            value: resources?.mana,
            cap: availableResources?.mana ?? 100,
            color: 'cyan'
        }, {
            label: '体力',
            value: resources?.energy,
            cap: availableResources?.energy ?? 100,
            color: 'lightgoldenrodyellow'
        }, {
            label: '储能',
            value: resources?.fury,
            cap: availableResources?.fury ?? 100,
            color: 'lightgreen'
        }];

        return <div className="character-resources-wrapper">
            {resourceLines.filter(r => r.cap > 0).map(resource => {
                const { label, value, cap, color } = resource;
                const percentage = getPercentage(value, cap);
                return <div className="character-resource" key={label}>
                    <div className="character-resource-label">{label}</div>
                    <ProgressBar className="character-resource-value" percentage={percentage} border={false} color={color}>{value}</ProgressBar>
                </div>
            })}
        </div>
    }, [availableResources, resources])

    const characterAttributes = useMemo(() => {
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

        return <div className="character-attributes-wrapper">
            {attributeLines.map(attribute => {
                const { label, value } = attribute;
                return <div className="character-attribute" key={label}>
                    <div className="character-attribute-label">{label}</div>
                    <div className="character-attribute-value">{value}</div>
                </div>
            })}
        </div>
    }, [attributes])

    const characterEnhancements = useMemo(() => {
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
            value: enhancements?.mastery.fire
        }, {
            label: '水',
            value: enhancements?.mastery.water
        }]

        return <div className="character-attributes-wrapper">
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
    }, [enhancements])

    return <div className={`character-wrapper ${className}`}>
        <div className="character-casting-wrapper">
            <div className="character-casting-name">{name}</div>
            <CastingBar></CastingBar>
        </div>
        {characterResources}
        {characterAttributes}
        {characterEnhancements}
    </div>
}

export default CharacterPanel