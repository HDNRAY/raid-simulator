import './Cooldown.scss';

const Cooldown = (props: {
    total?: number,
    value?: number,
    className?: string
}) => {
    const { className = '', value = 0, total = 0 } = props;

    const percentage = !!total ? value / total : 0;

    if (percentage === 0) {
        return null
    }

    const leftDegree = percentage < 0.5 ? 1 : 180 * 2 * (percentage - 0.5);
    const rightDegree = percentage < 0.5 ? 180 * 2 * percentage : 180;

    return <div className={`cooldown-mask ${className}`} >
        <div className="left-wrapper">
            <div className="left-mask" style={{ transform: `rotate(${leftDegree}deg) scale(150%)` }}></div>
        </div>
        <div className="right-wrapper">
            <div className="right-mask" style={{ transform: `rotate(${rightDegree}deg) scale(150%)` }}></div>
        </div>
    </div>
}

export default Cooldown