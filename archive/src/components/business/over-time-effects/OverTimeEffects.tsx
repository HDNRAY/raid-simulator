import ProgressBar from "components/basic/progress-bar/ProgressBar";
import { getPercentage } from "util/utils";
import './OverTimeEffects.scss';

const OverTimeEffects = (props: {
    className?: string,
    time: number,
    effects: Array<{
        id: string
        name: string,
        duration: number,
        startTime: number
    }>
}) => {
    const { effects, className, time } = props;
    return <div className={`overtime-effects-wrapper ${className}`}>
        {effects.map(effect => {
            const { startTime, duration, id, name } = effect;
            const remainTime = duration + startTime - time;
            const percentage = getPercentage(remainTime, duration);
            return <div key={id} className="overtime-effect">
                <div className="overtime-effect-label">{name}</div>
                <ProgressBar className="overtime-effect-progress" border={false} percentage={percentage}>{Math.round(remainTime / 1000)}s</ProgressBar>
            </div>
        })}
    </div>
}

export default OverTimeEffects