const Character = (props: {
    className?: string
}) => {
    const { className } = props;
    const resources = [{
        name: '血量',
        value: 1000,
        cap: 1000,
        color: 'red'
    }, {
        name: '蓝',
        value: 900,
        cap: 1000,
        color: 'blue'
    }, {
        name: '能量',
        value: 90,
        cap: 120,
        color: 'yellow'
    }, {
        name: '怒气',
        value: 10,
        cap: 120,
        color: 'green'
    }];
    return <div className={className}>
        <div>
            {resources.map(resource => {
                const { name, value, cap, color } = resource;
                const percentage = Math.round(100 * value / cap);
                return <div>
                    <div>{name}</div>
                    <div style={{ background: `linear-gradient(90deg, ${color} ${percentage}%,transparent ${percentage}%)` }}>{value}</div>
                </div>
            })}
        </div>
        <div>
            属性
        </div>
    </div>
}

export default Character