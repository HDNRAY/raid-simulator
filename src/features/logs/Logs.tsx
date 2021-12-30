import { useEffect, useRef } from "react";
import { Log } from "redux/log";
import { DamageLog } from "redux/raid";
import { useAppSelector } from "redux/store";
import './Logs.scss';

const Logs = (props: {
    className?: string
}) => {
    const { className } = props;

    const logs: Array<Log> = useAppSelector(state => state.log.logs);
    const damageLogs: Array<DamageLog> = useAppSelector(state => state.raid.effectHistory);

    const logsWrapper = useRef<HTMLDivElement>(null);
    const damageLogsWraper = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (logsWrapper.current) {
            logsWrapper.current.scrollTop = logsWrapper.current?.scrollHeight;
        }
    }, [logs]);

    useEffect(() => {
        if (damageLogsWraper.current) {
            damageLogsWraper.current.scrollTop = damageLogsWraper.current?.scrollHeight;
        }
    }, [damageLogs]);

    return <div className={className}>
        <div className={`logs-wrapper`} ref={logsWrapper}>
            {logs.map(log => {
                return <div className={`log-wrapper ${log.type}`} key={log.id}>{log.content}</div>
            })}
        </div>
        <div className={`damage-logs-wrapper`} ref={damageLogsWraper}>
            {damageLogs.map(log => {
                const { skill, caster, target, value } = log;
                return <div className={`log-wrapper`} key={log.id}>{`${caster.name}的${skill.name}对${target.name}造成${value}点伤害`}</div>
            })}
        </div>
    </div>
}

export default Logs;