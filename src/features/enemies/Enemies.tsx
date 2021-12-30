import { useAppSelector } from "redux/store";
import './Enemies.scss';

const Enemies = (props: {
    className?: string
}) => {
    const { className } = props;
    const enemies = useAppSelector(state => state.enemies.enemies)
    return <div className={`enemies-wrapper ${className}`}>
        {enemies.map(enemy => {
            const { id, health, name, status } = enemy;
            const percentage = Math.round(100 * status.health / health);
            return <div className="enemy-wrapper" key={id}>
                <div className="health" style={{ background: `linear-gradient(90deg, red ${percentage}%,transparent ${percentage}%)` }}>
                    <span className="current">{status.health}</span>/<span className="cap">{health}</span>
                </div>
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