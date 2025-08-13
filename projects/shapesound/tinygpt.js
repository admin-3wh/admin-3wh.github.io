// tinygpt.js
// TinyGPT in-browser loader and inference helper

let tinyGPTModel = null;

async function loadTinyGPT() {
    if (tinyGPTModel) return tinyGPTModel;
    console.log("Loading TinyGPT model...");
    tinyGPTModel = await tf.loadGraphModel('models/tinygpt/model.json');
    console.log("TinyGPT loaded.");
    return tinyGPTModel;
}

async function promptToScene(promptText) {
    if (!tinyGPTModel) await loadTinyGPT();

    // TODO: tokenize promptText to match model training
    const inputTensor = tokenizePrompt(promptText);

    const outputTensor = tinyGPTModel.execute({ "input_ids": inputTensor });

    // TODO: convert outputTensor back into ShapeSound DSL or JSON
    const sceneJSON = detokenizeOutput(outputTensor);

    return sceneJSON;
}

// Example placeholder tokenizer (will replace with your real one)
function tokenizePrompt(text) {
    // Convert to lowercase, split by spaces, etc.
    // Replace with proper tokenizer used during training
    const arr = text.toLowerCase().split(" ").map(w => w.length % 10); 
    return tf.tensor([arr]);
}

function detokenizeOutput(tensor) {
    // Convert model output back into a JS object
    return {
        shapes: [
            { type: "turtle", animation: "crawl", notes: ["C4", "D4"] }
        ]
    };
}

export { loadTinyGPT, promptToScene };
