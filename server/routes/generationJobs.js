import express from 'express';

function errorStatus(error) {
    if (error?.code === 'generation_job_not_found') return 404;
    if (error?.code === 'generation_proposal_conflict') return 409;
    if (error?.code === 'invalid_generation_job') return 400;
    if (/already has active generation job/.test(error?.message || '')) return 409;
    return 500;
}

export function createGenerationJobsRouter(runtime) {
    const router = express.Router();

    router.post('/', (req, res) => {
        try {
            const result = runtime.createImageJob(req.body);
            res.status(result.created ? 202 : 200).json(result);
        } catch (error) {
            res.status(errorStatus(error)).json({
                error: error.message || 'Generation job creation failed.',
                code: error.code || 'generation_job_error',
            });
        }
    });

    router.get('/:id', (req, res) => {
        try {
            res.json(runtime.getJob(req.params.id));
        } catch (error) {
            res.status(errorStatus(error)).json({
                error: error.message || 'Generation job lookup failed.',
                code: error.code || 'generation_job_error',
            });
        }
    });

    return router;
}

export default createGenerationJobsRouter;
