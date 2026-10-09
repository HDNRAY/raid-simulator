import Button from "components/basic/button/Button";
import { useCallback } from "react";
import { startRaid, stopRaid } from "redux/raid";
import { useAppDispatch, useAppSelector } from "redux/store";
import { timeShorter } from "util/utils";
import { setMainCharacter } from "redux/character";
import { you } from "data/character";

const Info = (props: {
    className?: string
}) => {
    const { className } = props;
    const dispatch = useAppDispatch();

    const time = useAppSelector(state => state.universal.time);
    const raidStartTime = useAppSelector(state => state.raid.raidStartTime);
    const raidStatus = 'started'// useAppSelector(state => state.raid.raidStatus);

    const initRaid = useCallback(() => {
        dispatch(setMainCharacter(you));
    }, [dispatch]);

    const onClick = useCallback(() => {
        if (raidStatus === 'started') {
            dispatch(stopRaid());
            initRaid()
        } else if (raidStatus === 'stopped') {
            dispatch(startRaid(time));
        }
    }, [dispatch, initRaid, time]);

    return <div className={className}>
        <div>{raidStartTime ? timeShorter(time - raidStartTime) : '--'}</div>
        <Button onClick={onClick}>{raidStatus === 'started' ? '重置' : '开始'}</Button>
    </div>
}

export default Info;