import Button from "components/Button/Button";
import { useCallback } from "react";
import { startRaid, initEnemies, stopRaid } from "redux/raid";
import { useAppDispatch, useAppSelector } from "redux/store";
import { enemies } from "data/enemies";
import { timeShorter } from "util/utils";

const Info = (props: {
    className?: string
}) => {
    const { className } = props;
    const dispatch = useAppDispatch();

    const time = useAppSelector(state => state.universal.time);
    const raidStartTime = useAppSelector(state => state.raid.raidStartTime);
    const raidStatus = useAppSelector(state => state.raid.raidStatus);

    const initRaid = useCallback(() => {
        dispatch(initEnemies(enemies));
    }, [dispatch]);

    const onClick = useCallback(() => {
        if (raidStatus === 'started') {
            dispatch(stopRaid());
            initRaid()
        } else if (raidStatus === 'stopped') {
            dispatch(startRaid());
        }
    }, [dispatch, initRaid, raidStatus]);

    return <div className={className}>
        <div>{raidStartTime ? timeShorter(time - raidStartTime) : '--'}</div>
        <Button onClick={onClick}>{raidStatus === 'started' ? '重置' : '开始'}</Button>
    </div>
}

export default Info;