import { enemies } from "data/enemies"
import Enemies from "features/enemies/Enemies"
import { useCallback, useEffect, useRef } from "react"
import { initEnemies } from "redux/raid"
import { initSlots } from "redux/slots"
import { useAppDispatch } from "redux/store"
import { updateTime } from "redux/universal"
import Logs from "../logs/Logs"
import Slots from "../slots/Slots"
import './Layout.scss'

const Layout = () => {
    const dispatch = useAppDispatch();

    const requestAnimationFrameRef = useRef<number>();

    useEffect(() => {
        dispatch(initSlots());
        dispatch(initEnemies(enemies));
    }, [dispatch]);

    const loop = useCallback(() => {
        setTimeout(() => {
            dispatch(updateTime());
            requestAnimationFrameRef.current = requestAnimationFrame(loop);
        }, 10);
    }, [dispatch])

    useEffect(() => {

        requestAnimationFrame(loop)

        return () => {
            cancelAnimationFrame(requestAnimationFrameRef.current!)
        }
    }, [loop]);

    return <div className='layout-wrapper'>
        <Enemies className="layout-enemies"></Enemies>
        <Logs className="layout-logs"></Logs>
        <Slots className="layout-slots"></Slots>
    </div>
}

export default Layout