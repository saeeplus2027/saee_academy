import { Router, type IRouter } from "express";
import healthRouter from "./health";
import coursesRouter from "./courses";
import studentRequestsRouter from "./student-requests";
import adminRouter from "./admin";
import { requireAuthenticatedUser } from "../middlewares/auth";

const router: IRouter = Router();

router.use(healthRouter);
router.use(requireAuthenticatedUser);
router.use(coursesRouter);
router.use(studentRequestsRouter);
router.use(adminRouter);

export default router;
