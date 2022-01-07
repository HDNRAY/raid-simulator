import dayjs from 'dayjs';

const timeShorter = (value: number, toSecond: boolean = true) => {
    if (isNaN(value)) {
        return undefined
    }

    if (value === 0) {
        return `0秒`
    }

    const t = dayjs.duration(value);
    const hours = t.hours();
    const minutes = t.minutes();
    let result = `${hours ? `${hours}小时` : ''} ${minutes ? `${minutes}分` : ''}`;
    if (toSecond) {
        result = `${result} ${t.seconds() || '0'}秒`
    }
    return result;
}

const getPercentage = (dividend?: number, divisor?: number) => {
    if (!divisor || !dividend) {
        return 0
    }

    return Math.round(1000 * dividend / divisor) / 10;
}

const checkTrigger = (threshold: number, options: {

} = {}) => {
    return Math.random() < threshold;
}

const numberToPercentage = (value?: number) => `${100 * (value ?? 0)}%`;

const unit = (value: number = 1) => `${value * 100 / 1920}vw`;

const computeCritical: (value: number, chance: number, criticalDamage: number) => [number, boolean]
    = (value: number, chance: number, criticalDamage: number) => {
        const critical = checkTrigger(chance);
        const result = critical ? parseInt((value * criticalDamage).toFixed(0)) : value;
        return [result, critical]
    }

export { timeShorter, getPercentage, checkTrigger, computeCritical, numberToPercentage, unit }