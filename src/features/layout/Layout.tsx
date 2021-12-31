import Character from "features/character/Character"
import Enemies from "features/enemies/Enemies"
import Info from "features/info/Info"
import { useCallback, useEffect, useRef } from "react"
import { useAppDispatch } from "redux/store"
import { updateTime } from "redux/universal"
import Logs from "../logs/Logs"
import Slots from "../slots/Slots"
import './Layout.scss'

const Layout = () => {
    const dispatch = useAppDispatch();

    const requestAnimationFrameRef = useRef<number>();

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
        <Info className="layout-info"></Info>
        <Enemies className="layout-enemies"></Enemies>
        <Logs className="layout-logs"></Logs>
        <Slots className="layout-slots"></Slots>
        <Character className="layout-character"></Character>
    </div>
}

export default Layout