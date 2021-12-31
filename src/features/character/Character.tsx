import { you } from "data/character";
import { useEffect } from "react";
import { Character, setMainCharacter } from "redux/character";
import { useAppDispatch, useAppSelector } from "redux/store";
import './Character.scss';

const CharacterPanel = (props: {
    className?: string
}) => {
    const { className } = props;

    const dispatch = useAppDispatch();
    const character: Character | undefined = useAppSelector(state => state.character.mainCharacter);

    useEffect(() => {
        dispatch(setMainCharacter(you));
    }, [dispatch]);

    if (!character) {
        return null;
    }

    const { staticResource, realtimeResource, realtimeAttributes } = character;
    const resources = [{
        label: '血量',
        value: realtimeResource?.health,
        cap: staticResource.health,
        color: 'red'
    }, {
        label: '蓝',
        value: realtimeResource?.mana,
        cap: staticResource.mana,
        color: 'blue'
    }, {
        label: '能量',
        value: realtimeResource?.energy,
        cap: staticResource.energy,
        color: 'yellow'
    }, {
        label: '怒气',
        value: realtimeResource?.fury,
        cap: staticResource.fury,
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
        <div className="character-resources-wrapper">
            {resources.filter(r => r.cap > 0).map(resource => {
                const { label, value, cap, color } = resource;
                const percentage = Math.round(100 * (value ?? 0) / cap);
                const style = {
                    background: `linear-gradient(90deg, ${color} ${percentage}%,transparent ${percentage}%)`
                }
                return <div className="character-resource" key={label}>
                    <div className="character-resource-label">{label}</div>
                    <div className="character-resource-value" style={style}>
                        {value}
                    </div>
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