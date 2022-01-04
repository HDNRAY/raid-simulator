import Enemies from 'features/enemies/Enemies';
import Statistics from 'features/statistics/Statistics';
import './Battle.scss';

const BattleScene = (props: {
    className: string
}) => {
    const { className } = props;

    return <div className={`battle-scene-wrapper ${className}`}>
        <Enemies className="battle-enemies"></Enemies>
        <Statistics className='battle-statistics'></Statistics>
    </div>
}

export default BattleScene;