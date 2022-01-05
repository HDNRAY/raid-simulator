import ProgressBar from "components/ProgressBar/ProgressBar";
import { enemies } from "data/enemies";
import { useEffect } from "react";
import { initEnemies } from "redux/raid";
import { useAppDispatch, useAppSelector } from "redux/store";
import './Enemies.scss';

const Enemies = (props: {
    className?: string
}) => {
    const dispatch = useAppDispatch();
    const { className } = props;
    const selectedEnemies = useAppSelector(state => state.raid.enemies)

    useEffect(() => {
        dispatch(initEnemies(enemies));
    }, [dispatch]);

    return <div className={`enemies-wrapper ${className}`}>
        {selectedEnemies.map(enemy => {
            const { id, realtimeResource, name, staticResource } = enemy;
            const percentage = Math.round(100 * (realtimeResource?.health || 0) / staticResource.health);
            return <div className="enemy-wrapper" key={id}>
                <ProgressBar className="health" percentage={percentage} color="orangered" textColor="white">
                    <span className="current">{realtimeResource?.health}</span>/<span className="cap">{staticResource.health}</span>
                </ProgressBar>
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