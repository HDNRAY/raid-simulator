import Enemies from 'features/enemies/Enemies';
import './Battle.scss';

const BattleScene = (props: {
    className: string
}) => {
    const { className } = props;

    return <div className={`battle-scene-wrapper ${className}`}>
        <Enemies className="battle-enemies"></Enemies>
    </div>
}

export default BattleScene;