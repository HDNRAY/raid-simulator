import ProgressBar from "components/basic/progress-bar/ProgressBar";
import OverTimeEffects from "components/business/over-time-effects/OverTimeEffects";
import { enemies } from "data/enemies";
import { skillMap } from "data/skills";
import { useEffect } from "react";
import { initEnemies } from "redux/raid";
import { useAppDispatch, useAppSelector } from "redux/store";
import { OverTimeEffect } from "types/types";
import './Enemies.scss';

const Enemies = (props: {
    className?: string
}) => {
    const dispatch = useAppDispatch();
    const { className } = props;
    const selectedEnemies = useAppSelector(state => state.raid.enemies)

    const time = useAppSelector(state => state.universal.time);

    useEffect(() => {
        dispatch(initEnemies(enemies));
    }, [dispatch]);

    return <div className={`enemies-wrapper ${className}`}>
        {selectedEnemies.map(enemy => {
            const { id, resources, name, availableResources, overTimeEffects } = enemy;
            const percentage = Math.round(100 * (resources?.health || 0) / availableResources.health);
            const effects = overTimeEffects.map(item => {
                const { skillId, effectId } = item;
                const skill = skillMap[skillId];
                const effect: OverTimeEffect = skill.effects.find(i => i.id === effectId) as OverTimeEffect;
                return {
                    id: effect.id,
                    name: effect.name || skill.name,
                    startTime: item.startTime,
                    duration: effect.duration
                }
            })

            return <div className="enemy-wrapper" key={id}>
                <ProgressBar className="health" percentage={percentage} color="orangered" textColor="white">
                    <span className="current">{resources?.health}</span>/<span className="cap">{availableResources.health}</span>
                </ProgressBar>
                <OverTimeEffects className="enemy-effects" time={time} effects={effects}></OverTimeEffects>
                <div className="name">{name}</div>
                <div className="corner left-top-corner"></div>
                <div className="corner left-bottom-corner"></div>
                <div className="corner right-top-corner"></div>
                <div className="corner right-bottom-corner"></div>
            </div>
        })}
    </div>
}

export default Enemies;