import ProgressBar from "components/ProgressBar/ProgressBar";
import { you } from "data/character";
import { useCallback, useEffect } from "react";
import { Character, doneCasting, setMainCharacter } from "redux/character";
import { castSkillOnEnemy } from "redux/raid";
import { Skill } from "redux/skill";
import { useAppDispatch, useAppSelector } from "redux/store";
import { getPercentage } from "util/utils";
import './Character.scss';

const CharacterPanel = (props: {
    className?: string
}) => {
    const { className } = props;

    const dispatch = useAppDispatch();
    const character: Character | undefined = useAppSelector(state => state.character.mainCharacter);
    const time = useAppSelector(state => state.universal.time);

    useEffect(() => {
        dispatch(setMainCharacter(you));
    }, [dispatch]);

    const doEffect = useCallback((skill: Skill) => {
        dispatch(castSkillOnEnemy({ skill, targetId: '1', time }))
        dispatch(doneCasting())
    }, [dispatch, time]);

    const { staticResource, realtimeResource, realtimeAttributes, name, castingSkill, castingTime } = character || {};

    const castingTimePast = castingTime ? time - castingTime : 0;
    const castingPercentage = getPercentage(castingTimePast, castingSkill?.castTime);

    const castingTimeRemain = castingSkill ? Math.max(castingSkill.castTime - castingTimePast, 0) / 1000 : 0

    useEffect(() => {
        if (castingSkill) {
            if (castingSkill.castTime === 0) {
                doEffect(castingSkill);
            } else if (castingTimePast >= castingSkill.castTime) {
                doEffect(castingSkill);
            }
        }
    }, [castingSkill, castingTimePast, dispatch, doEffect])

    if (!character) {
        return null;
    }

    const resources = [{
        label: '血量',
        value: realtimeResource?.health,
        cap: staticResource?.health ?? 100,
        color: 'red'
    }, {
        label: '蓝',
        value: realtimeResource?.mana,
        cap: staticResource?.mana ?? 100,
        color: 'blue'
    }, {
        label: '能量',
        value: realtimeResource?.energy,
        cap: staticResource?.energy ?? 100,
        color: 'yellow'
    }, {
        label: '怒气',
        value: realtimeResource?.fury,
        cap: staticResource?.fury ?? 100,
        color: 'green'
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
    </div>
}

export default CharacterPanel