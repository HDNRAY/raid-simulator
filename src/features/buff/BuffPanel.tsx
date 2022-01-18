import OverTimeEffects from "components/business/over-time-effects/OverTimeEffects";
import { skillMap } from "data/skills";
import { useEffect } from "react";
import { computeBuffs } from "redux/character";
import { useAppDispatch, useAppSelector } from "redux/store";
import { OverTimeEffect } from "types/types";
import './BuffPanel.scss';

const BuffPanel = (props: {
    className?: string
}) => {
    const { className } = props;

    const dispatch = useAppDispatch();

    const time = useAppSelector(state => state.universal.time);

    const buffs: any = useAppSelector(state => {
        const c = state.character.mainCharacter;
        if (!c) {
            return []
        } else {
            const result = c.overTimeEffects.map(overTimeEffect => {
                const skill = skillMap[overTimeEffect.skillId];
                const effect = skill.effects.find(i => i.id === overTimeEffect.effectId) as OverTimeEffect;
                return {
                    ...overTimeEffect,
                    // skill,
                    // effect,
                    type: effect.type,
                    id: overTimeEffect.effectId,
                    name: skill.name,
                    duration: effect.duration,
                }
            }).filter(i => i.type === 'buff');
            return result;
        }
    }, (previous, current) => {
        return previous.length === current.length
            && previous.every((p, i) => p.effectId === current[i].effectId)
            && previous.every((p, i) => p.startTime === current[i].startTime)
    });

    // buff属性
    useEffect(() => {
        dispatch(computeBuffs(buffs))
    }, [buffs, dispatch])

    return <OverTimeEffects className={`buffs-wrapper ${className}`} time={time} effects={buffs}></OverTimeEffects>

}

export default BuffPanel;